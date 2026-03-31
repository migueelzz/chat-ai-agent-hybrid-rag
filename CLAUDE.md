# CLAUDE.md — ATEM RAG

Guia de referência para o agente de código. Leia antes de qualquer modificação.

---

## Fluxo de trabalho obrigatório

**Antes de qualquer modificação de código:**

1. **Sempre ative o Plan Mode** (`EnterPlanMode`) — descreva a abordagem, arquivos afetados e impactos antes de escrever qualquer linha.
2. **Após concluir as modificações**, registre as mudanças em `CHANGELOG.md` (backend) ou `web/CHANGELOG.md` (frontend), seguindo o formato:

```markdown
## [não lançado] — YYYY-MM-DD

### Adicionado
- Descrição objetiva do que foi adicionado

### Alterado
- Descrição do que foi modificado e por quê

### Corrigido
- Descrição do bug corrigido
```

- Modificações **só de backend** (`app/`, `scripts/`, raiz) → registrar em `CHANGELOG.md`
- Modificações **só de frontend** (`web/`) → registrar em `web/CHANGELOG.md`
- Modificações **em ambos** → registrar em ambos os arquivos, cada um com sua seção relevante

---

## Visão Geral do Projeto

Assistente SAP da **Prime Control** — chatbot especializado em SAP (FI, CO, MM, SD, PP) alimentado por RAG híbrido + LLM via LangGraph. Usuários fazem perguntas em linguagem natural; o agente busca na base de conhecimento interna, navega URLs, pesquisa na web e aplica skills especializadas.

**Stack:**
- **Backend:** Python 3.13, FastAPI, LangGraph, SQLAlchemy async, PostgreSQL + pgvector
- **Frontend:** React 19, TypeScript, Tailwind v4, Vite 8 → ver `web/CLAUDE.md`
- **Infra:** Docker Compose (postgres com pgvector/pg16), PDM como gerenciador de pacotes

---

## Estrutura de Pastas

```
atem-rag/
├── app/
│   ├── main.py              # FastAPI app + lifespan (init checkpointer, MCP, agent)
│   ├── config.py            # Settings via pydantic-settings (.env)
│   ├── database.py          # Engine SQLAlchemy async + get_db() dependency
│   ├── agent/
│   │   ├── agent.py         # Singleton LangGraph ReAct agent (create_react_agent)
│   │   ├── tools.py         # Ferramentas: rag_search, web_search, scrape_url, use_skill
│   │   ├── prompts.py       # SYSTEM_PROMPT — identidade, protocolo de tools, estrutura de resposta
│   │   ├── memory.py        # AsyncPostgresSaver (checkpointer LangGraph)
│   │   ├── context_var.py   # ContextVar para propagar AsyncSession → tools
│   │   └── mcp_tools.py     # MCP opcional: CAP, UI5, Fiori (MCP_ENABLED=true)
│   ├── routers/
│   │   ├── chat.py          # /chat — sessões, streaming SSE, attachments
│   │   ├── skills.py        # /skills — CRUD de skills (upload .md/.txt)
│   │   ├── ingest.py        # /ingest — upload e processamento de PDFs
│   │   └── query.py         # /query — busca direta (debug/admin)
│   ├── retrieval/
│   │   ├── hybrid.py        # vector_search + fts_search + trigram_search
│   │   ├── rrf.py           # Reciprocal Rank Fusion
│   │   └── context.py       # build_context() — monta dict com docs + chunks + entidades
│   ├── ingestion/
│   │   ├── parser.py        # Extração de texto de PDFs (PyMuPDF + pdfplumber)
│   │   ├── chunker.py       # Divisão em chunks por tokens (NLTK)
│   │   ├── embedder.py      # Embeddings com paraphrase-MiniLM-L6-v2 (384d)
│   │   └── extractor.py     # Extração de entidades SAP (regex + heurísticas)
│   └── models/
│       └── chat.py          # Pydantic models: MessageRequest, MessageChunk, HistoryResponse
├── scripts/
│   ├── 00_schema.sql        # Schema completo — executado automaticamente no Docker
│   ├── migration_*.sql      # Migrations incrementais para bancos existentes
│   └── init_db.py           # Script de ingestão inicial (pdm run ingest)
├── web/                     # Frontend React — ver web/CLAUDE.md
├── docker-compose.yml       # PostgreSQL com pgvector; monta scripts/ como initdb
├── pyproject.toml           # Dependências PDM + scripts dev/lint/fmt
└── SKILL.md                 # Exemplo de skill no formato correto
```

---

## Arquitetura e Padrões

### Fluxo de uma mensagem

```
POST /chat/{session_id}/message
  → _stream_agent()
      → carregar session_files (contexto TXT do usuário)
      → carregar skills index compacto (nome + descrição)
      → agent.astream_events() via LangGraph
          → LLM decide tools: rag_search / web_search / scrape_url / use_skill
          → emite SSE: token | thinking | tool_start | tool_end | error | done
  → StreamingResponse (text/event-stream)
```

### LangGraph Agent

- **Singleton** criado no lifespan; nunca recriar em runtime.
- Usar `create_react_agent` com `checkpointer=AsyncPostgresSaver` — o histórico de mensagens é persistido por `thread_id = session_id`.
- Para adicionar tools: importar e incluir na lista em `agent.py`. O agente **precisa ser reiniciado** para refletir mudanças (singleton).
- O `SYSTEM_PROMPT` em `prompts.py` define identidade e protocolo de tools. Alterações afetam todos os usuários imediatamente.

### Tools

Toda tool que acessa o banco **deve** usar `db_session_var.get()` — nunca criar nova sessão dentro da tool. A sessão é propagada via `ContextVar` do request FastAPI.

```python
# Padrão obrigatório para tools com DB
@tool
async def minha_tool(param: str) -> str:
    session = db_session_var.get()
    if session is None:
        return "Erro interno: sessão não disponível."
    # ...
```

Tools com chamadas de rede **devem** capturar exceções e retornar mensagem de erro como string — nunca lançar exceção de dentro da tool (quebra o stream SSE).

```python
try:
    result = await operacao_de_rede()
    return result
except Exception as exc:
    return f"Indisponível no momento ({type(exc).__name__}). Use o RAG."
```

### Retrieval (RAG)

Pipeline em 3 etapas — não alterar a ordem:
1. `hybrid_search()` → 3 listas paralelas (vector + FTS + trigram)
2. `rrf_fusion()` → lista única rankeada por Reciprocal Rank Fusion
3. `build_context()` → monta dict com chunks âncora + vizinhos + entidades SAP

Budget de contexto: **12.000 chars (~3.000 tokens)** por chamada de RAG. Não aumentar sem medir impacto no custo.

### Streaming SSE

Formato de cada evento:
```
data: {"type": "token"|"thinking"|"tool_start"|"tool_end"|"error"|"done", "content": "...", "tool_name": null}\n\n
```

- Tokens com `content.strip() == ""` são **descartados** (whitespace puro de tabelas markdown).
- Sequências de 5+ traços são colapsadas para `---` (`_collapse_table_padding`).
- O evento `done` **sempre** é emitido, inclusive após erros tratados.

### Skills (lazy loading)

- **Índice compacto** (nome + descrição, max 150 chars) injetado em toda mensagem quando há skills ativas.
- **Conteúdo completo** carregado pela tool `use_skill(name)` apenas quando o agente decide usar.
- Invocação manual (`/skill-name` no frontend): backend injeta instrução obrigatória para o agente chamar `use_skill` como primeira ação.
- Formato do arquivo de skill: frontmatter YAML com `name:` e `description:`, conteúdo após `---`.

### Sessões e Histórico

- `session_id` = UUID gerado no frontend, usado como `thread_id` no LangGraph.
- Arquivos TXT da sessão são armazenados em `session_files` e injetados no contexto de **toda** mensagem da sessão.
- Ao carregar histórico (`GET /chat/{id}/history`), mensagens com prefixo `[Contexto de arquivos...]` têm o prefixo removido no frontend — não no backend.

---

## Banco de Dados

### Tabelas principais

| Tabela | Propósito |
|---|---|
| `sources` | PDFs ingeridos (filename, modulo, file_size_bytes) |
| `documents` | Seções/capítulos dos PDFs |
| `chunks` | Unidades de retrieval com embedding (vector 384d) + FTS + trigram |
| `entities` | Entidades SAP extraídas (tabelas, transações, CDS) |
| `session_files` | Arquivos de sessão: TXT, ZIP extraído, PDF (texto extraído) e imagem (BYTEA) |
| `skills` | Skills especializadas (CRUD via /skills) |
| `aliases` | Sinônimos SAP para expansão de queries |
| `sap_catalog` | Catálogo de transações e tabelas conhecidas |

### Regras de DB

- **Nunca** usar ORM SQLAlchemy models — apenas `text()` com queries SQL explícitas.
- **Sempre** usar `await session.execute(text(...), {...})` com parâmetros nomeados (prevenção de SQL injection).
- `await db.commit()` apenas em routers, nunca dentro de tools ou retrieval.
- Migrations novas: criar `scripts/migration_<descricao>.sql` com `IF NOT EXISTS` / `IF NOT EXISTS column` para idempotência.

### Atualização obrigatória do schema

**Toda vez que houver qualquer mudança estrutural no banco de dados** (nova tabela, nova coluna, novo índice, alteração de tipo, remoção):

1. **Perguntar ao usuário antes de modificar** — nunca aplicar mudanças no schema sem confirmação explícita.
2. **Criar `scripts/migration_<descricao>.sql`** — script incremental idempotente para bancos existentes.
3. **Atualizar `scripts/00_schema.sql`** — manter o schema completo sincronizado com a estrutura real, usando `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.

> O `00_schema.sql` é a fonte de verdade para novas instalações (executado automaticamente pelo Docker). Se ele divergir da estrutura real, novos ambientes ficam quebrados.

---

## Configuração e Ambiente

Variáveis em `.env` na raiz (ver `.env.example`):

```env
DATABASE_URL=postgresql+asyncpg://atem:atem_secret@localhost:5432/atem_rag
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
LLM_BASE_URL=              # vazio = OpenAI direto; preencher para LiteLLM proxy
LLM_MAX_TOKENS=4096
LLM_TEMPERATURE=0.3
MCP_ENABLED=false          # true para ativar SAP MCP servers (requer Node.js)
LLM_HAS_VISION=true        # false para modelos sem suporte a vision (image_url)
MAX_PDF_PAGES=30            # máximo de páginas extraídas por anexo PDF de sessão
```

O backend é agnóstico ao provider LLM — qualquer API compatível com OpenAI funciona via `LLM_BASE_URL`.

---

## Comandos de Desenvolvimento

```bash
# Backend
pdm install              # instalar dependências
pdm run dev              # uvicorn com hot-reload (porta 8000)
pdm run lint             # ruff check
pdm run fmt              # ruff format

# Frontend
cd web
pnpm install
pnpm dev                 # Vite dev server (porta 5173)
pnpm build               # build de produção

# Docker
docker compose up -d     # sobe PostgreSQL (cria schema automaticamente)
docker compose down -v   # derruba e limpa volume (reset completo do banco)

# Migrations em banco existente
psql -U atem -d atem_rag -f scripts/migration_<nome>.sql
```

---

## Segurança

- **Filenames de upload**: sempre sanitizar com regex `[^a-zA-Z0-9\-_]` → `-` antes de persistir.
- **Tamanho de uploads**: PDF (ingest RAG) sem limite definido (cuidado); TXT session files = 500 KB; PDF session files = 10 MB; Imagens session files = 5 MB; Skills = 200 KB.
- **SQL**: usar exclusivamente `text()` com parâmetros nomeados — nunca f-string em queries.
- **CORS**: origins fixas em `main.py` (`localhost:5173`). Adicionar domínio de produção antes do deploy.
- **Identidade do LLM**: o `SYSTEM_PROMPT` proíbe revelar o modelo base — não remover essa seção.
- **Segredos**: `LLM_API_KEY` e credenciais de DB somente via `.env`, nunca hardcoded.

---

## O que NÃO fazer

- **Não recriar o agente LangGraph em runtime** — é singleton inicializado no lifespan.
- **Não usar `await db.commit()` dentro de tools** — apenas em routers após a operação completa.
- **Não adicionar lógica de negócio em `main.py`** — apenas bootstrap (lifespan, routers, middleware).
- **Não criar novos modelos SQLAlchemy ORM** — o projeto usa SQL raw por design.
- **Não alterar `SYSTEM_PROMPT` sem testar** — afeta comportamento de todos os usuários imediatamente.
- **Não aumentar o budget de contexto RAG** sem medir custo — 12.000 chars é deliberado.
- **Não lançar exceções dentro de tools** — capturar e retornar string de erro.
