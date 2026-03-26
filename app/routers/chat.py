import re
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.agent import get_agent
from app.agent.context_var import db_session_var
from app.agent.memory import get_checkpointer
from app.database import get_db
from app.models.chat import (
    CreateSessionResponse,
    HistoryMessage,
    HistoryResponse,
    MessageChunk,
    MessageRequest,
)

router = APIRouter()

# Colapsa sequências longas de traços usadas como padding em separadores de tabela Markdown.
# Alguns LLMs (ex: Gemini) alinham visualmente as colunas gerando centenas de "-",
# o que infla o stream e causa falhas de parsing no frontend.
_TABLE_PADDING = re.compile(r'-{5,}')


def _collapse_table_padding(text: str) -> str:
    return _TABLE_PADDING.sub('---', text)


# Validação de filename: apenas letras, números, espaço, _ - .
_SAFE_FILENAME = re.compile(r'^[\w\s\-\.]+$')
MAX_TXT_BYTES = 500 * 1024  # 500 KB


# ---------------------------------------------------------------------------
# POST /chat/sessions — cria nova sessão
# ---------------------------------------------------------------------------

@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session():
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


async def _stream_agent(
    session_id: str,
    message: str,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    token = db_session_var.set(db)
    try:
        agent = await get_agent()
        config = {"configurable": {"thread_id": session_id}}

        # Incluir arquivos da sessão como contexto adicional
        files_ctx = await _load_session_files(session_id, db)
        if files_ctx:
            full_message = f"{files_ctx}\n\nPergunta do usuário: {message}"
        else:
            full_message = message

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
                                if text_content and text_content.strip():
                                    text_content = _collapse_table_padding(text_content)
                                    payload = MessageChunk(type="token", content=text_content)
                                    yield f"data: {payload.model_dump_json()}\n\n"
                    else:
                        text_content = str(content)
                        # Ignorar tokens que são apenas espaços em branco
                        # (artefato de tabelas markdown com padding excessivo)
                        if text_content.strip():
                            # Colapsar separadores de tabela com padding excessivo
                            # ex: ":-------...-------" → ":---"
                            text_content = _collapse_table_padding(text_content)
                            payload = MessageChunk(type="token", content=text_content)
                            yield f"data: {payload.model_dump_json()}\n\n"

            elif event_type == "on_tool_start":
                tool_name = event.get("name", "")
                payload = MessageChunk(type="tool_start", content="", tool_name=tool_name)
                yield f"data: {payload.model_dump_json()}\n\n"

            elif event_type == "on_tool_end":
                tool_name = event.get("name", "")
                output = str(event["data"].get("output", ""))[:2000]
                payload = MessageChunk(type="tool_end", content=output, tool_name=tool_name)
                yield f"data: {payload.model_dump_json()}\n\n"

        yield f"data: {MessageChunk(type='done', content='').model_dump_json()}\n\n"

    except Exception as exc:
        payload = MessageChunk(type="error", content=str(exc))
        yield f"data: {payload.model_dump_json()}\n\n"
    finally:
        db_session_var.reset(token)


@router.post("/{session_id}/message")
async def send_message(
    session_id: str,
    req: MessageRequest,
    db: AsyncSession = Depends(get_db),
):
    return StreamingResponse(
        _stream_agent(session_id, req.message, db),
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
    return HistoryMessage(role=role, content=content)


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
# POST /chat/{session_id}/attachments — upload de arquivo TXT
# ---------------------------------------------------------------------------

@router.post("/{session_id}/attachments")
async def upload_attachment(
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
