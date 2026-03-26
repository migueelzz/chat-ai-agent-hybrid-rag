import json
import re

import html2text
import httpx
from langchain_core.tools import tool
from langchain_community.tools import DuckDuckGoSearchRun

from app.agent.context_var import db_session_var
from app.retrieval.context import build_context


# ---------------------------------------------------------------------------
# Ferramenta 1 — RAG Search
# ---------------------------------------------------------------------------

def _format_context(ctx: dict) -> str:
    """Converte o dict de build_context em texto legível para o LLM (~3000 tokens máx).
    Inclui metadados de fontes como comentário HTML no início para o frontend parsear.
    """
    if not ctx["documents"]:
        return "Nenhum resultado encontrado na base de conhecimento para esta consulta."

    # Metadados estruturados de fontes (parseable pelo frontend)
    sources_meta = [
        {
            "id": doc.get("source_id"),
            "filename": doc.get("source_filename", ""),
            "size": doc.get("source_size_bytes", 0),
        }
        for doc in ctx["documents"]
        if doc.get("source_id")
    ]

    parts: list[str] = [
        f"<!--SOURCES_META:{json.dumps(sources_meta, ensure_ascii=False)}-->",
        f"**Consulta:** {ctx['query']}\n",
    ]
    char_budget = 12_000  # ~3000 tokens

    for doc in ctx["documents"]:
        title = doc["document_title"] or f"Documento #{doc['document_id']}"
        parts.append(f"\n### {title}")

        for chunk in doc["chunks"]:
            if not chunk["is_anchor"]:
                continue  # inclui apenas chunks âncora para reduzir tamanho
            content = chunk["content"][:600]  # trunca chunks longos
            parts.append(content)

            entities = chunk.get("entities", [])
            if entities:
                vals = ", ".join(e["valor"] for e in entities[:10])
                parts.append(f"*Entidades SAP:* {vals}")

        text_so_far = "\n".join(parts)
        if len(text_so_far) > char_budget:
            break

    return "\n".join(parts)


@tool
async def rag_search(query: str) -> str:
    """Busca na base de conhecimento SAP interna (manuais ATEM). Use esta ferramenta primeiro para qualquer pergunta sobre SAP."""
    session = db_session_var.get()
    if session is None:
        return "Erro interno: sessão de banco de dados não disponível."
    ctx = await build_context(session, query, top_n=8, window_size=1)
    return _format_context(ctx)


# ---------------------------------------------------------------------------
# Ferramenta 2 — Web Search (DuckDuckGo, sem API key)
# ---------------------------------------------------------------------------

def build_web_search_tool() -> DuckDuckGoSearchRun:
    return DuckDuckGoSearchRun(
        name="web_search",
        description=(
            "Busca na internet por informações SAP atuais, SAP Notes, patches ou novidades. "
            "Use apenas quando o rag_search for insuficiente ou quando o usuário pedir explicitamente."
        ),
    )


# ---------------------------------------------------------------------------
# Ferramenta 3 — URL Scraper
# ---------------------------------------------------------------------------

def _github_blob_to_raw(url: str) -> str:
    """Converte URL de visualização do GitHub para URL de conteúdo raw."""
    # https://github.com/owner/repo/blob/branch/path → https://raw.githubusercontent.com/owner/repo/branch/path
    pattern = r"https://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)"
    match = re.match(pattern, url)
    if match:
        owner, repo, branch, path = match.groups()
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    return url


@tool
async def scrape_url(url: str) -> str:
    """Acessa e lê o conteúdo de uma URL fornecida pelo usuário. Use quando o usuário fornecer um link específico de documentação ou página web."""
    raw_url = _github_blob_to_raw(url.strip())

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ATEM-RAG-Bot/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(raw_url, headers=headers)

        if response.status_code >= 400:
            return f"Erro ao acessar a URL: HTTP {response.status_code}."

        content_type = response.headers.get("content-type", "")

        # Conteúdo já é texto/markdown puro (GitHub raw, .txt, .md)
        if "text/plain" in content_type or raw_url != url.strip():
            text = response.text
        else:
            # HTML → Markdown via html2text
            converter = html2text.HTML2Text()
            converter.ignore_links = False
            converter.body_width = 0
            converter.ignore_images = True
            converter.ignore_emphasis = False
            text = converter.handle(response.text)

        # Truncar para não explodir o contexto
        max_chars = 10_000
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[... conteúdo truncado após {max_chars} caracteres ...]"

        return text.strip()

    except httpx.TimeoutException:
        return "Erro: timeout ao acessar a URL (limite de 15 segundos excedido)."
    except httpx.RequestError as e:
        return f"Erro de conexão ao acessar a URL: {e}"
