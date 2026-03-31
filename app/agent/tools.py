import asyncio
import json
import re
from typing import Dict

import html2text
import httpx
from langchain_core.tools import tool
from sqlalchemy import text

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

@tool
async def web_search(query: str) -> str:
    """Busca na internet por informações SAP atuais, SAP Notes, patches ou novidades.
    Use apenas quando o rag_search for insuficiente ou quando o usuário pedir explicitamente."""
    try:
        from langchain_community.tools import DuckDuckGoSearchRun  # import local para evitar falha no startup

        _tool = DuckDuckGoSearchRun()
        loop = asyncio.get_event_loop()
        result: str = await loop.run_in_executor(None, _tool.run, query)
        return result
    except Exception as exc:
        return (
            f"Pesquisa web indisponível no momento ({type(exc).__name__}: {exc}). "
            "Responda com base nos resultados do RAG."
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


# ---------------------------------------------------------------------------
# Ferramenta 4 — Skills especializadas (lazy loading)
# ---------------------------------------------------------------------------

_MAX_SKILL_CHARS = 6_000


@tool
async def use_skill(skill_name: str) -> str:
    """Carrega o conteúdo completo de uma skill especializada para guiar a resposta.
    Use quando a pergunta do usuário se encaixar em uma das skills listadas no contexto,
    ou quando receber a instrução OBRIGATÓRIA de usar uma skill específica."""
    session = db_session_var.get()
    if session is None:
        return "Erro interno: sessão de banco de dados não disponível."
    result = await session.execute(
        text("SELECT title, content FROM skills WHERE name = :n AND is_active = true"),
        {"n": skill_name},
    )
    skill = result.fetchone()
    if not skill:
        return f"Skill '{skill_name}' não encontrada ou inativa."
    content = skill.content
    if len(content) > _MAX_SKILL_CHARS:
        content = content[:_MAX_SKILL_CHARS] + "\n\n[... skill truncada após 8000 caracteres ...]"
    return f"[SKILL: {skill.title}]\n\n{content}"


# ---------------------------------------------------------------------------
# Ferramenta 6 — ZIP File Explorer
# ---------------------------------------------------------------------------

@tool
async def zip_file_explorer(zip_filename: str, action: str = "list") -> str:
    """
    Explora a estrutura de arquivos extraídos de um ZIP específico.
    
    Args:
        zip_filename: Nome do arquivo ZIP original
        action: 'list' para listar estrutura, 'tree' para árvore hierárquica
    
    Returns:
        Estrutura organizacional dos arquivos do ZIP ou mensagem de erro.
    """
    session = db_session_var.get()
    if session is None:
        return "Erro interno: sessão de banco de dados não disponível."
    
    try:
        # Buscar todos os arquivos extraídos deste ZIP
        result = await session.execute(
            text("""
                SELECT filename, zip_path, size_bytes 
                FROM session_files 
                WHERE source_zip = :zip_name 
                ORDER BY zip_path
            """),
            {"zip_name": zip_filename}
        )
        
        files = result.fetchall()
        if not files:
            return f"Nenhum arquivo encontrado para o ZIP '{zip_filename}'. Verifique se o nome está correto."
        
        if action == "tree":
            return _build_directory_tree(files)
        else:
            return _build_file_list(files, zip_filename)
            
    except Exception as e:
        return f"Erro ao explorar ZIP '{zip_filename}': {str(e)}"


def _build_file_list(files, zip_filename: str) -> str:
    """Constrói uma lista simples de arquivos com tamanhos."""
    lines = [f"📦 {zip_filename} ({len(files)} arquivos extraídos)\n"]
    
    total_size = 0
    for file in files:
        zip_path = file.zip_path or file.filename.replace('[ZIP] ', '')
        size_kb = file.size_bytes / 1024
        total_size += file.size_bytes
        
        if size_kb < 1:
            size_str = f"{file.size_bytes}B"
        elif size_kb < 1024:
            size_str = f"{size_kb:.1f}KB"
        else:
            size_str = f"{size_kb/1024:.1f}MB"
            
        lines.append(f"  📄 {zip_path} ({size_str})")
    
    total_mb = total_size / (1024 * 1024)
    lines.append(f"\n💾 Tamanho total: {total_mb:.1f}MB")
    
    return "\n".join(lines)


def _build_directory_tree(files) -> str:
    """Constrói uma árvore hierárquica dos arquivos."""
    tree: Dict[str, Dict] = {}
    
    for file in files:
        zip_path = file.zip_path or file.filename.replace('[ZIP] ', '')
        parts = zip_path.split('/')
        
        current = tree
        for part in parts[:-1]:  # Diretórios
            if part not in current:
                current[part] = {"__dirs__": {}, "__files__": []}
            current = current[part]["__dirs__"]
        
        # Arquivo final
        if parts:
            filename = parts[-1]
            parent_dir = current if len(parts) == 1 else current
            
            # Encontrar o diretório pai correto
            if len(parts) > 1:
                for part in parts[:-1]:
                    if part not in tree:
                        tree[part] = {"__dirs__": {}, "__files__": []}
                    parent_dir = tree[part]
                    
            if "__files__" not in parent_dir:
                parent_dir["__files__"] = []
            parent_dir["__files__"].append({
                "name": filename,
                "size": file.size_bytes
            })
    
    return _format_tree(tree, "")


def _format_tree(node: Dict, prefix: str, is_last: bool = True) -> str:
    """Formata a árvore de diretórios recursivamente."""
    if not node:
        return ""
    
    lines = []
    items = list(node.items())
    
    for i, (name, content) in enumerate(items):
        is_last_item = (i == len(items) - 1)
        
        if isinstance(content, dict) and "__dirs__" in content:
            # É um diretório
            connector = "└── " if is_last_item else "├── "
            lines.append(f"{prefix}{connector}📁 {name}/")
            
            # Recursão para subdiretórios
            new_prefix = prefix + ("    " if is_last_item else "│   ")
            if content["__dirs__"]:
                lines.append(_format_tree(content["__dirs__"], new_prefix))
            
            # Arquivos no diretório
            if content.get("__files__"):
                for j, file_info in enumerate(content["__files__"]):
                    is_last_file = (j == len(content["__files__"]) - 1)
                    file_connector = "└── " if is_last_file else "├── "
                    size_str = f" ({file_info['size']}B)" if file_info['size'] < 1024 else f" ({file_info['size']/1024:.1f}KB)"
                    lines.append(f"{new_prefix}{file_connector}📄 {file_info['name']}{size_str}")
    
    return "\n".join(filter(None, lines))
