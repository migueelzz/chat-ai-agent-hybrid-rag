import re

from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, ToolMessage
from langchain_openai import ChatOpenAI

from app.agent.memory import get_checkpointer  # sync após init
from app.agent.prompts import SYSTEM_PROMPT
from app.agent.tools import rag_search, web_search, scrape_url, use_skill, zip_file_explorer, write_output_file
from app.agent.mcp_tools import get_mcp_tools
from app.config import settings

_agent = None

_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _resolve_llm() -> ChatOpenAI:
    provider = (settings.llm_provider or "").strip().lower()
    if provider == "google":
        base_url = _GOOGLE_BASE_URL
        model = settings.llm_model.removeprefix("gemini/")
    else:
        base_url = settings.llm_base_url or None
        model = settings.llm_model

    extra_kwargs: dict = {}
    if settings.llm_thinking_budget > 0:
        if provider == "google":
            # Google AI API (direto): usa thinkingConfig no body da requisição
            extra_kwargs["model_kwargs"] = {
                "thinkingConfig": {"thinkingBudget": settings.llm_thinking_budget}
            }
        else:
            # LiteLLM proxy: passa thinking via extra_body (OpenAI SDK ≥ 1.x)
            extra_kwargs["extra_body"] = {
                "thinking": {"type": "enabled", "budget_tokens": settings.llm_thinking_budget}
            }

    return ChatOpenAI(
        model=model,
        api_key=settings.llm_api_key or "no-key",
        base_url=base_url,
        max_tokens=settings.llm_max_tokens,
        temperature=settings.llm_temperature,
        streaming=True,
        max_retries=0,  # falha rápida — sem retry automático no proxy LiteLLM
        **extra_kwargs,
    )


# Colapsa runs de 15+ espaços para um único espaço (padding de colunas em tabelas Markdown).
# Reduz tokens desperdiçados em mensagens de ferramentas que o agente recebe de volta.
_EXCESS_SPACES = re.compile(r' {15,}')

# Limite de caracteres ao comprimir ToolMessages antigas de cada ferramenta.
# Ferramentas que retornam grandes blocos de texto têm custo relevante por token
# (Gemini cobra por token mesmo com janela de 1M). Manter conteúdo completo de
# chamadas antigas não agrega valor — o LLM já processou e gerou resposta a partir delas.
_TOOL_COMPRESS_LIMITS: dict[str, int] = {
    'use_skill':  600,   # skills são longas; 600 chars preserva instruções de orquestração
    'rag_search': 600,   # RAG retorna até ~12.000 chars; comprimir antigas reduz custo
    'web_search': 400,   # resultados de busca web são volumosos
    'scrape_url': 400,   # conteúdo de página pode ser muito grande
}


def _compress_tool_history(state: dict) -> dict:
    """
    pre_model_hook — executado antes de cada chamada ao LLM.

    Aplica duas otimizações de tokens sem alterar o estado persistido no checkpointer:

    1. Janela deslizante: mantém apenas as últimas `max_history_messages` mensagens,
       iniciando sempre em um HumanMessage (evita corte no meio de um turno).
       Garante custo linear em vez de quadrático conforme a conversa cresce.

    2. Compressão de ToolMessages antigas: para cada ferramenta em _TOOL_COMPRESS_LIMITS,
       todas as ocorrências exceto a mais recente são truncadas ao limite de chars definido.
       A mais recente de cada ferramenta é mantida intacta (com colapso de espaços excessivos).
       Isso cobre use_skill, rag_search, web_search e scrape_url.
    """
    messages = state.get("messages", [])

    # 1. Janela deslizante (não altera checkpointer)
    limit = settings.max_history_messages
    if len(messages) > limit:
        trimmed = messages[-limit:]
        # Garantir que não cortamos no meio de um turno — iniciar em HumanMessage
        first_human = next(
            (i for i, m in enumerate(trimmed) if isinstance(m, HumanMessage)), 0
        )
        messages = trimmed[first_human:]

    # 2. Coletar índices de cada ferramenta comprimível
    tool_indices: dict[str, list[int]] = {}
    for i, msg in enumerate(messages):
        if isinstance(msg, ToolMessage):
            name = getattr(msg, 'name', '') or ''
            if name in _TOOL_COMPRESS_LIMITS:
                tool_indices.setdefault(name, []).append(i)

    # Mapeia índice → limite de chars (todas as ocorrências menos a última de cada ferramenta)
    to_compress: dict[int, int] = {}
    for name, indices in tool_indices.items():
        for idx in indices[:-1]:  # todas menos a última
            to_compress[idx] = _TOOL_COMPRESS_LIMITS[name]

    if not to_compress:
        # Nada a comprimir — ainda aplica colapso de espaços nas mensagens de ferramenta
        result = []
        for msg in messages:
            if isinstance(msg, ToolMessage) and getattr(msg, 'name', '') in _TOOL_COMPRESS_LIMITS:
                content = _EXCESS_SPACES.sub(' ', str(msg.content))
                result.append(ToolMessage(content=content, tool_call_id=msg.tool_call_id, name=msg.name))
            else:
                result.append(msg)
        return {"llm_input_messages": result}

    result = []
    for i, msg in enumerate(messages):
        if not isinstance(msg, ToolMessage):
            result.append(msg)
            continue

        content = str(msg.content)
        if i in to_compress:
            char_limit = to_compress[i]
            content = content[:char_limit].rstrip() + "\n\n[... conteúdo resumido — já processado pelo agente ...]"
        else:
            # Colapsa padding excessivo de espaços na mensagem mais recente
            content = _EXCESS_SPACES.sub(' ', content)

        result.append(ToolMessage(
            content=content,
            tool_call_id=msg.tool_call_id,
            name=msg.name,
        ))
    return {"llm_input_messages": result}


async def get_agent():
    """
    Retorna singleton do agente ReAct (LangGraph).
    Agnóstico ao provider — usa ChatOpenAI com base_url customizada,
    compatível com LiteLLM proxy, OpenAI direto, ou qualquer proxy OpenAI-compatible.
    """
    global _agent
    if _agent is None:
        llm = _resolve_llm()
        checkpointer = get_checkpointer()
        tools = [rag_search, web_search, scrape_url, use_skill, zip_file_explorer, write_output_file]
        if settings.mcp_enabled:
            tools += get_mcp_tools()
        _agent = create_react_agent(
            model=llm,
            tools=tools,
            checkpointer=checkpointer,
            prompt=SYSTEM_PROMPT,
            pre_model_hook=_compress_tool_history,
        )
    return _agent
