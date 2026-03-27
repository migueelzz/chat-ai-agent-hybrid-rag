# Changelog — Backend

Todas as mudanças relevantes do backend são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)

---

## [não lançado] — 2026-03-26

### Adicionado
- Sistema de Skills: tabela `skills`, router `/skills` com CRUD (upload `.md`/`.txt`, toggle ativo/inativo, delete)
- Tool `use_skill` no agente LangGraph para carregamento lazy de skills por nome
- Injeção de índice compacto de skills (nome + descrição) em cada mensagem quando há skills ativas
- Invocação manual de skill via `skill_name` no `MessageRequest`: backend injeta instrução obrigatória para o agente chamar `use_skill` como primeira ação
- `scripts/migration_skills.sql`: migration idempotente para a tabela `skills`
- `scripts/00_schema.sql`: schema completo renomeado de `schema.sql` para garantir execução antes das migrations no Docker initdb

### Alterado
- `app/agent/tools.py`: `web_search` reescrito como `@tool async def` com tratamento de exceções (evita crash do stream SSE por `ConnectError` do DuckDuckGo)
- `app/agent/prompts.py`: removida seção "DOCUMENTOS DE REFERÊNCIA" da estrutura obrigatória de resposta; adicionada instrução de uso de `use_skill`; regra de separadores de tabela compactos (`| --- |`)
- `app/routers/chat.py`: adicionado `_collapse_table_padding()` para colapsar sequências de 5+ traços em separadores de tabela; adicionado `_load_skills_index()`; contexto de mensagem rebuilt com `ctx_parts`
- `app/models/chat.py`: adicionado `skill_name: str | None = None` ao `MessageRequest`
- `app/main.py`: incluído router de skills com prefix `/skills`

### Corrigido
- Tabelas Markdown com centenas de traços quebrando o parse de JSON no frontend (colapso de `---...---` → `---`)
- `ConnectError` do DuckDuckGo propagando como exceção não tratada e abortando o stream SSE
- Docker Compose executando `migration_*.sql` antes do `schema.sql` (corrigido renomeando para `00_schema.sql`)
