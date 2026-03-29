import json
import re
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.agent import get_agent
from app.config import settings
from app.limiter import limiter
from app.agent.context_var import db_session_var
from app.agent.memory import get_checkpointer
from app.database import get_db
from app.models.chat import (
    CreateSessionResponse,
    ExtractDocumentRequest,
    HistoryMessage,
    HistoryResponse,
    MessageChunk,
    MessageRequest,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Skill chains — orchestrator → fases em ordem
# ---------------------------------------------------------------------------

_SKILL_CHAINS: dict[str, list[str]] = {
    "cds-doc-analysis": [
        "cds-structural-analysis",
        "cds-behavior-analysis",
        "cds-context-inference",
        "cds-doc-generator",
    ],
}

# Conjunto de todos os skills que são orquestradores (iniciam uma chain)
_ORCHESTRATORS: set[str] = set(_SKILL_CHAINS.keys())

# Conjunto de todos os skills que são fases de uma chain
_CHAIN_PHASES: set[str] = {s for chain in _SKILL_CHAINS.values() for s in chain}


def _next_in_chain(skill_name: str | None) -> str | None:
    """Retorna o próximo skill na chain, ou None se for o último ou não pertencer a nenhuma chain."""
    if not skill_name:
        return None
    for chain in _SKILL_CHAINS.values():
        if skill_name in chain:
            idx = chain.index(skill_name)
            return chain[idx + 1] if idx + 1 < len(chain) else None
    return None


# Colapsa sequências longas de traços usadas como padding em separadores de tabela Markdown.
# Alguns LLMs (ex: Gemini) alinham visualmente as colunas gerando centenas de "-",
# o que infla o stream e causa falhas de parsing no frontend.
_TABLE_PADDING = re.compile(r'-{5,}')

# Detecta intenção de gerar documento/pesquisa detalhada na mensagem do usuário
_DOC_INTENT_RE = re.compile(
    r'\b(documenta[çc][aã]o|documento\s+t[eé]cnico|pesquisa\s+detalhada|'
    r'pesquisa\s+aprofundada|relat[oó]rio|an[aá]lise\s+detalhada|gere\s+um\s+documento|'
    r'crie\s+uma?\s+documenta[çc][aã]o)\b',
    re.IGNORECASE,
)


def _collapse_table_padding(text: str) -> str:
    return _TABLE_PADDING.sub('---', text)


_HEADING_RE = re.compile(r'#{2,6} \S')


def _fix_code_block_headings(text: str, in_code_block: bool) -> tuple[str, bool]:
    """Injeta ``` de fechamento quando um heading markdown (## ou mais) aparece dentro
    de um bloco de código não fechado — corrige erros de geração do LLM."""
    lines = text.split('\n')
    fixed: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            fixed.append(line)
        elif in_code_block and _HEADING_RE.match(stripped):
            fixed.extend(['```', '', line])
            in_code_block = False
        else:
            fixed.append(line)
    return '\n'.join(fixed), in_code_block


# Validação de filename: apenas letras, números, espaço, _ - .
_SAFE_FILENAME = re.compile(r'^[\w\s\-\.]+$')
MAX_TXT_BYTES = 500 * 1024  # 500 KB


# ---------------------------------------------------------------------------
# POST /chat/sessions — cria nova sessão
# ---------------------------------------------------------------------------

@router.post("/sessions", response_model=CreateSessionResponse)
@limiter.limit("20/minute")
async def create_session(request: Request):  # noqa: ARG001
    return CreateSessionResponse(
        session_id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# POST /chat/{session_id}/message — envia mensagem (streaming SSE)
# ---------------------------------------------------------------------------

async def _load_session_files(session_id: str, db: AsyncSession) -> str:
    """Carrega arquivos TXT da sessão e retorna bloco de contexto."""
    result = await db.execute(
        text("SELECT filename, content FROM session_files WHERE session_id = :sid ORDER BY created_at"),
        {"sid": session_id},
    )
    rows = result.fetchall()
    if not rows:
        return ""
    parts = ["[Contexto de arquivos enviados pelo usuário nesta sessão]"]
    for row in rows:
        parts.append(f"\n--- Arquivo: {row.filename} ---\n{row.content[:8000]}")
    parts.append("--- fim dos arquivos ---\n")
    return "\n".join(parts)


async def _load_skills_index(db: AsyncSession) -> str:
    """Retorna índice compacto das skills ativas (nome + descrição truncada)."""
    try:
        result = await db.execute(
            text(
                "SELECT name, description FROM skills WHERE is_active = true "
                "ORDER BY name LIMIT 20"
            )
        )
        rows = result.fetchall()
        if not rows:
            return ""
        lines = "\n".join(f"- {r.name}: {r.description[:150].rstrip()}" for r in rows)
        return f"[Skills especializadas disponíveis — chame use_skill(name) quando a pergunta se encaixar]\n{lines}"
    except Exception:
        return ""


async def _stream_agent(
    session_id: str,
    message: str,
    db: AsyncSession,
    skill_names: list[str] | None = None,
    web_search_enabled: bool = True,
) -> AsyncGenerator[str, None]:
    token = db_session_var.set(db)
    _is_document = bool(_DOC_INTENT_RE.search(message))
    last_used_skill: str | None = None
    _in_code_block = False  # rastreia se o stream está dentro de um bloco ```
    try:
        agent = await get_agent()
        config = {"configurable": {"thread_id": session_id}}

        # Construir contexto completo da mensagem
        ctx_parts: list[str] = []

        # 1. Arquivos da sessão
        files_ctx = await _load_session_files(session_id, db)
        if files_ctx:
            ctx_parts.append(files_ctx)

        # 2. Skills — invocação manual obriga o agente a chamar use_skill na ordem indicada;
        #    sem invocação manual, injeta apenas o índice compacto para auto-detecção.
        if skill_names:
            if len(skill_names) == 1:
                sn = skill_names[0]
                if sn in _ORCHESTRATORS:
                    # Orquestrador: executa apenas a PRIMEIRA fase indicada pela skill
                    ctx_parts.append(
                        f"INSTRUÇÃO OBRIGATÓRIA: Use a skill '{sn}' chamando "
                        f"use_skill('{sn}') como PRIMEIRA ação para obter o protocolo de análise. "
                        f"Em seguida, execute SOMENTE a PRIMEIRA fase/skill indicada pelo protocolo. "
                        f"Complete-a integralmente e PARE. "
                        f"NÃO continue para fases subsequentes automaticamente."
                    )
                elif sn in _CHAIN_PHASES:
                    # Fase de uma chain: executa apenas esta fase
                    ctx_parts.append(
                        f"INSTRUÇÃO OBRIGATÓRIA: Use a skill '{sn}' chamando "
                        f"use_skill('{sn}') como ÚNICA ação desta etapa. "
                        f"Execute-a completamente e PARE. "
                        f"O histórico da conversa contém os resultados das fases anteriores. "
                        f"Seja conciso e objetivo — limite-se ao essencial de cada etapa, evitando repetições ou elaborações desnecessárias. "
                        f"FORMATAÇÃO: sempre feche blocos de código (```) antes de iniciar um novo heading (##, ###). Nunca coloque títulos de seção dentro de blocos de código."
                    )
                else:
                    # Skill avulsa: comportamento padrão (executa tudo em sequência)
                    ctx_parts.append(
                        f"INSTRUÇÃO OBRIGATÓRIA: Use a skill '{sn}' chamando "
                        f"use_skill('{sn}') como PRIMEIRA ação antes de qualquer outra. "
                        f"Se a skill definir um fluxo de múltiplas fases ou indicar skills subsequentes, "
                        f"execute-as TODAS em sequência sem parar — chame cada skill indicada imediatamente "
                        f"após concluir a fase anterior. NÃO emita resposta parcial entre as fases."
                    )
            else:
                skills_list = ', '.join(f"'{n}'" for n in skill_names)
                ctx_parts.append(
                    f"INSTRUÇÃO OBRIGATÓRIA: Execute as skills {skills_list} em sequência, "
                    f"chamando use_skill() para cada uma na ordem listada. "
                    f"Conclua completamente cada skill antes de passar para a próxima."
                )
        else:
            skills_index = await _load_skills_index(db)
            if skills_index:
                ctx_parts.append(skills_index)

        # 3. Web search — quando desabilitado, instrui o agente a não usar a ferramenta
        if not web_search_enabled:
            ctx_parts.append("INSTRUÇÃO: Não utilize a ferramenta web_search nesta resposta. Use apenas o rag_search.")

        ctx_parts.append(f"Pergunta do usuário: {message}")
        full_message = "\n\n".join(ctx_parts)

        input_state = {"messages": [HumanMessage(content=full_message)]}

        async for event in agent.astream_events(input_state, config=config, version="v2"):
            event_type = event.get("event", "")

            if event_type == "on_chat_model_stream":
                chunk = event["data"].get("chunk")
                if chunk and chunk.content:
                    content = chunk.content
                    # Modelos com thinking (Gemini, Claude extended) retornam lista de blocos
                    if isinstance(content, list):
                        for block in content:
                            if not isinstance(block, dict):
                                continue
                            if block.get("type") == "thinking":
                                thinking_text = block.get("thinking", "") or block.get("text", "")
                                if thinking_text and thinking_text.strip():
                                    payload = MessageChunk(type="thinking", content=thinking_text)
                                    yield f"data: {payload.model_dump_json()}\n\n"
                            elif block.get("type") == "text":
                                text_content = block.get("text", "")
                                if text_content and ("\n" in text_content or text_content.strip()):
                                    text_content, _in_code_block = _fix_code_block_headings(text_content, _in_code_block)
                                    text_content = _collapse_table_padding(text_content)
                                    payload = MessageChunk(type="token", content=text_content)
                                    yield f"data: {payload.model_dump_json()}\n\n"
                    else:
                        text_content = str(content)
                        if "\n" in text_content or text_content.strip():
                            text_content, _in_code_block = _fix_code_block_headings(text_content, _in_code_block)
                            text_content = _collapse_table_padding(text_content)
                            payload = MessageChunk(type="token", content=text_content)
                            yield f"data: {payload.model_dump_json()}\n\n"

            elif event_type == "on_tool_start":
                tool_name = event.get("name", "")
                tool_input = event.get("data", {}).get("input", {})
                if tool_name == "use_skill":
                    _is_document = True
                    if isinstance(tool_input, dict):
                        used = tool_input.get("skill_name")
                        if used:
                            last_used_skill = used
                tool_input_json = json.dumps(tool_input, ensure_ascii=False)
                payload = MessageChunk(type="tool_start", content=tool_input_json, tool_name=tool_name)
                yield f"data: {payload.model_dump_json()}\n\n"

            elif event_type == "on_tool_end":
                tool_name = event.get("name", "")
                output = str(event["data"].get("output", ""))[:2000]
                payload = MessageChunk(type="tool_end", content=output, tool_name=tool_name)
                yield f"data: {payload.model_dump_json()}\n\n"

            elif event_type == "on_chat_model_end":
                out = event.get("data", {}).get("output")
                if out is not None:
                    metadata = getattr(out, "response_metadata", {}) or {}
                    # Normaliza finish_reason entre providers:
                    # OpenAI/LiteLLM: finish_reason="length"
                    # Anthropic:       stop_reason="max_tokens"
                    # Alguns proxies:  finish_reasons=["length"]
                    reason = (
                        metadata.get("finish_reason")
                        or metadata.get("stop_reason")
                        or (metadata.get("finish_reasons") or [None])[0]
                    )
                    if reason in ("length", "max_tokens"):
                        raise RuntimeError(
                            "A resposta ficou longa demais para ser processada de uma vez. "
                            "Tente dividir a análise em etapas menores — por exemplo, execute cada fase separadamente."
                        )

        next_skill = _next_in_chain(last_used_skill)
        yield f"data: {MessageChunk(type='done', content='', is_document=_is_document, next_skill=next_skill).model_dump_json()}\n\n"

    except Exception as exc:
        error_msg = str(exc)
        if "Expecting value" in error_msg and "line 1 column 1" in error_msg:
            error_msg = (
                "A resposta ficou longa demais para ser processada de uma vez. "
                "Tente dividir a análise em etapas menores — por exemplo, execute cada fase separadamente."
            )
        # Se a falha ocorreu após uma skill ser invocada (ex: timeout na geração da resposta),
        # inclui next_skill apontando para a mesma fase — permite retry via chip de sugestão.
        payload = MessageChunk(type="error", content=error_msg, next_skill=last_used_skill)
        yield f"data: {payload.model_dump_json()}\n\n"
    finally:
        db_session_var.reset(token)


@router.post("/{session_id}/message")
@limiter.limit("20/minute")
async def send_message(
    request: Request,  # noqa: ARG001
    session_id: str,
    req: MessageRequest,
    db: AsyncSession = Depends(get_db),
):
    return StreamingResponse(
        _stream_agent(session_id, req.message, db, req.skill_names or None, req.web_search_enabled),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# GET /chat/{session_id}/history — retorna histórico persistido
# ---------------------------------------------------------------------------

def _msg_to_model(msg) -> HistoryMessage:
    if isinstance(msg, HumanMessage):
        role = "human"
    elif isinstance(msg, AIMessage):
        role = "assistant"
    elif isinstance(msg, ToolMessage):
        role = "tool"
    else:
        role = "unknown"

    content = msg.content if isinstance(msg.content, str) else str(msg.content)
    tool_name = msg.name if isinstance(msg, ToolMessage) else None
    return HistoryMessage(role=role, content=content, tool_name=tool_name)


@router.get("/{session_id}/history", response_model=HistoryResponse)
async def get_history(session_id: str):
    checkpointer = get_checkpointer()
    config = {"configurable": {"thread_id": session_id}}
    checkpoint = await checkpointer.aget(config)

    if checkpoint is None:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")

    messages = checkpoint.get("channel_values", {}).get("messages", [])
    return HistoryResponse(
        session_id=session_id,
        messages=[_msg_to_model(m) for m in messages],
    )


# ---------------------------------------------------------------------------
# DELETE /chat/{session_id} — encerra sessão
# ---------------------------------------------------------------------------

@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str):
    return None


# ---------------------------------------------------------------------------
# POST /chat/{session_id}/extract-document — extrai documento limpo via LLM
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "Você é um formatador de documentação técnica. "
    "Extraia APENAS o documento técnico formal do texto abaixo, "
    "removendo qualquer explicação, comentário introdutório ou conclusivo do assistente de IA. "
    "Retorne somente o documento em Markdown, iniciando pelo primeiro heading principal (#). "
    "Se não houver documento técnico claro, retorne o conteúdo original sem alterações."
)


@router.post("/{session_id}/extract-document")
@limiter.limit("10/minute")
async def extract_document(request: Request, session_id: str, req: ExtractDocumentRequest):  # noqa: ARG001
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage as LCHuman

    llm = ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.llm_api_key or "no-key",
        base_url=settings.llm_base_url or None,
        max_tokens=settings.llm_max_tokens,
        temperature=0.1,
        streaming=False,
    )
    try:
        result = await llm.ainvoke([SystemMessage(content=_EXTRACT_SYSTEM), LCHuman(content=req.content)])
        document = result.content if isinstance(result.content, str) else req.content
    except Exception:
        document = req.content

    return {"document": document}


# ---------------------------------------------------------------------------
# POST /chat/{session_id}/attachments — upload de arquivo TXT
# ---------------------------------------------------------------------------

@router.post("/{session_id}/attachments")
@limiter.limit("30/minute")
async def upload_attachment(
    request: Request,  # noqa: ARG001
    session_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    # 1. Validar extensão
    filename = file.filename or "arquivo.txt"
    if not filename.lower().endswith(".txt"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .txt são aceitos.")

    # 2. Sanitizar filename
    safe_name = re.sub(r'[^\w\s\-\.]', '_', filename)
    if not safe_name:
        safe_name = "arquivo.txt"

    # 3. Ler conteúdo com limite de tamanho
    raw = await file.read(MAX_TXT_BYTES + 1)
    if len(raw) > MAX_TXT_BYTES:
        raise HTTPException(status_code=413, detail="Arquivo excede o limite de 500 KB.")

    # 4. Decodificar como UTF-8
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            content = raw.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Não foi possível decodificar o arquivo como texto.")

    size_bytes = len(raw)

    # 5. Persistir
    result = await db.execute(
        text("""
            INSERT INTO session_files(session_id, filename, content, size_bytes)
            VALUES(:sid, :fn, :ct, :sz) RETURNING id
        """),
        {"sid": session_id, "fn": safe_name, "ct": content, "sz": size_bytes},
    )
    file_id = result.scalar()
    await db.commit()

    return {"id": file_id, "filename": safe_name, "size_bytes": size_bytes}


# ---------------------------------------------------------------------------
# GET /chat/{session_id}/attachments — lista arquivos da sessão
# ---------------------------------------------------------------------------

@router.get("/{session_id}/attachments")
async def list_attachments(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT id, filename, size_bytes FROM session_files WHERE session_id = :sid ORDER BY created_at"),
        {"sid": session_id},
    )
    return [{"id": row.id, "filename": row.filename, "size_bytes": row.size_bytes} for row in result]
