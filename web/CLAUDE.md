# Frontend — CLAUDE.md

Guia para o assistente de IA trabalhar neste frontend React + TypeScript.

---

## Fluxo de trabalho obrigatório

**Antes de qualquer modificação de código:**

1. **Sempre ative o Plan Mode** (`EnterPlanMode`) — descreva a abordagem, componentes afetados e impactos antes de escrever qualquer linha.
2. **Após concluir as modificações**, registre as mudanças em `web/CHANGELOG.md`, seguindo o formato:

```markdown
## [não lançado] — YYYY-MM-DD

### Adicionado
- Descrição objetiva do que foi adicionado

### Alterado
- Descrição do que foi modificado e por quê

### Corrigido
- Descrição do bug corrigido
```

- Se a modificação envolver também o backend, registrar adicionalmente em `CHANGELOG.md` na raiz do projeto.

---

## Stack

| Ferramenta | Versão | Observação |
|---|---|---|
| React | 19 | Sem Context API para estado global — estado local + hooks |
| TypeScript | 5.9 | `strict: true`, sem `any` |
| Vite | 8 | Dev server + build |
| Tailwind CSS | v4 | Config via CSS (`index.css`), **não** `tailwind.config.js` |
| React Router | v7 | `BrowserRouter` + `Routes`/`Route` |
| Axios | 1.x | Chamadas REST (`lib/api.ts`) |
| Fetch nativo | — | Apenas para SSE (`streamMessage`) — axios não suporta `ReadableStream` |
| shadcn/ui | v4 | Componentes base em `components/ui/` |
| lucide-react | — | Ícones — importe apenas os usados |
| react-markdown | 10 | Renderização de Markdown com `remark-gfm` |

---

## Estrutura de pastas

```
web/src/
├── app.tsx                     # Roteador raiz (BrowserRouter + Routes)
├── main.tsx                    # Entrypoint — monta <App />
├── index.css                   # Tailwind v4 + variáveis de tema CSS
│
├── components/
│   ├── chat/                   # Componentes exclusivos da tela de chat
│   │   ├── assistant-message.tsx   # Mensagem do AI: Markdown, fontes, thinking
│   │   ├── chat-input.tsx          # Input + skill picker + badges de arquivo
│   │   ├── message-list.tsx        # Lista de mensagens com scroll automático
│   │   ├── sources-panel.tsx       # Badges de fontes RAG abaixo da resposta
│   │   ├── thinking-panel.tsx      # Collapsible mostrando tool calls
│   │   ├── tool-badge.tsx          # Badge individual de ferramenta (rag, web, skill…)
│   │   └── user-message.tsx        # Mensagem do usuário + badges de anexos abaixo
│   ├── home/
│   │   ├── home-input.tsx          # Input da home com skill picker (mesma lógica do chat-input)
│   │   └── suggestion-chips.tsx    # Chips de sugestão rápida
│   ├── layout/
│   │   └── nav-sidebar.tsx         # Sidebar de navegação (Home, Chats, Skills)
│   └── ui/                         # shadcn/ui — não edite diretamente
│
├── hooks/
│   ├── use-chat.ts             # Estado de chat: mensagens, streaming, ferramentas
│   └── use-sessions.ts         # Lista de sessões no localStorage
│
├── lib/
│   ├── api.ts                  # Todas as chamadas HTTP (axios + fetch para SSE)
│   ├── sessions.ts             # CRUD de sessões no localStorage
│   ├── types.ts                # Interfaces TypeScript compartilhadas
│   └── utils.ts                # cn() — merge de classes Tailwind
│
└── pages/
    ├── _layouts/
    │   └── app-layout.tsx      # Layout com sidebar + <Outlet />
    ├── home-page.tsx           # Tela inicial com input e chips
    ├── chat-page.tsx           # Tela de chat (carrega skills + histórico)
    ├── chats-page.tsx          # Lista de sessões recentes
    └── skills-page.tsx         # CRUD de skills (upload .md/.txt)
```

---

## Roteamento

- Todas as rotas ficam aninhadas em `<AppLayout>` (sidebar + outlet)
- Rotas atuais: `/` (home), `/chats`, `/chat/:sessionId`, `/skills`
- Para adicionar uma rota: (1) criar page em `pages/`, (2) adicionar `<Route>` em `app.tsx`, (3) adicionar item na `nav-sidebar.tsx`
- Navegação com estado (passar dados entre rotas): `navigate(path, { state: { ... } })` + `useLocation()` no destino
  - **Atenção**: objetos `File` passados via state vivem em memória e são perdidos em F5

---

## Tipos principais (`lib/types.ts`)

```typescript
ChatMessage    // id, role, content, toolCalls?, thinkingContent?, attachments?...
ToolCall       // id, name, status ('running'|'done'), output?
Source         // type ('doc'|'web'|'file'), label, filename?, url?
AttachmentMeta // id, filename, size_bytes
SkillMeta      // id, name, title, description, is_active, created_at
MessageChunk   // type ('token'|'tool_start'|'tool_end'|'thinking'|'error'|'done'), content, tool_name?
```

Nunca use `any`. Se precisar de um tipo novo, adicione em `types.ts`.

---

## API (`lib/api.ts`)

- Instância axios: `http` com `baseURL = import.meta.env.VITE_API_BASE_URL`
- **REST**: sempre via `http` (axios)
- **SSE / streaming**: `streamMessage()` usa `fetch` nativo com `ReadableStream` — async generator que emite `MessageChunk`
- Variável de ambiente obrigatória: `VITE_API_BASE_URL` (ex.: `http://localhost:8000`)
- Erros de rede em funções de lista (ex.: `getAttachments`) devem retornar `[]` em vez de propagar

---

## Hook `use-chat.ts`

O coração do chat. Gerencia:
- Estado de mensagens (`ChatMessage[]`)
- Streaming via `streamMessage()` async generator
- Tool calls: `tool_start` → status `'running'`; `tool_end` → status `'done'`
- Upload de arquivos antes de enviar a mensagem
- `loadHistory()`: carrega histórico e strip do prefixo `[Contexto de arquivos...]` injetado pelo backend
- `retryLast()`: remove última mensagem do assistente e reenvia
- `stopStreaming()`: `abortRef.current?.abort()`

**Regras do hook**:
- Nunca acesse o DOM diretamente — use refs apenas para `AbortController`
- Estado de mensagens: sempre imutável (`prev.map(...)`, nunca `.push()`)
- `useCallback` em todas as funções retornadas para estabilidade de referência

---

## Componentes de chat

### `AssistantMessage`
- Renderiza `content` com `<ReactMarkdown>` + `remark-gfm`
- `<ThinkingPanel>` exibe tool calls colapsável acima do conteúdo
- `<SourcesPanel>` exibe fontes **abaixo** do conteúdo (badges)
- Parseia `<!--SOURCES_META:{...}-->` do conteúdo para extrair metadados de fontes

### `UserMessage`
- Exibe bolha de texto do usuário
- Badges de anexos (`AttachmentMeta[]`) ficam **abaixo** da bolha, não acima

### `ChatInput` e `HomeInput`
- Ambos implementam o **slash command** para skills:
  - Digitar `/` abre popover acima do textarea com lista filtrável
  - `Tab` seleciona o primeiro; `Escape` fecha; `onMouseDown + e.preventDefault()` evita blur antes do clique
  - Skill selecionada vira badge removível no input
- Arquivos: só `.txt`, máx 500 KB, sem duplicatas
- `handleChange` detecta `/` no início e abre o picker; qualquer outro char fecha

### `ThinkingPanel`
- Collapsible — fechado por padrão, abre quando há tool calls
- Cada ferramenta tem ícone e label em `tool-badge.tsx`:
  - `rag_search` → Database + "Pesquisando base de conhecimento"
  - `web_search` → Globe + "Pesquisando na web"
  - `use_skill` → Zap + "Aplicando skill especializada"
  - `scrape_url` → Link + "Lendo URL"

---

## Tailwind v4 — regras importantes

- **Não existe `tailwind.config.js`** — tudo via `@theme` em `index.css`
- Tokens de cor disponíveis: `sidebar-primary`, `sidebar-foreground`, `muted`, `card`, `border`, `ring`, `destructive` (e seus `-foreground`)
- Utilitários de animação via `tw-animate-css`
- `cn()` em `lib/utils.ts` = `clsx` + `tailwind-merge` — sempre use para classes condicionais

---

## Padrões de código

### Componentes
```tsx
// Sempre named export, nunca default export
export function MyComponent({ prop }: Props) { ... }

// Props interface acima do componente, no mesmo arquivo (a menos que seja compartilhada)
interface Props { ... }
```

### Estado
- Estado local: `useState` dentro do componente
- Estado derivado: compute na renderização, não guarde em estado separado
- Estado compartilhado entre páginas: hooks customizados (`use-chat`, `use-sessions`)
- **Sem Redux, Zustand ou Context API** — o projeto não usa gerenciamento de estado global

### Eventos assíncronos no JSX
```tsx
// void para suprimir a promise em handlers inline
onClick={() => void sendMessage(text)}
```

### Importações
- Caminho absoluto via alias `@/` (configurado no Vite)
- Nunca use caminhos relativos com `../..`
- Ordene: libs externas → `@/components` → `@/hooks` → `@/lib` → tipos

---

## Segurança

- **Nunca use `dangerouslySetInnerHTML`** — todo HTML externo deve passar por `react-markdown`
- `react-markdown` com `remark-gfm` já escapa HTML por padrão — não desative
- Não exponha variáveis de ambiente sensíveis no frontend (prefixo `VITE_` é público por design)
- Sanitize nomes de arquivo antes de exibir (use só `.filename`, não construa URLs a partir deles)
- Não armazene tokens ou dados sensíveis no `localStorage` — apenas IDs e títulos de sessão

---

## O que NÃO fazer

- **Não crie hooks para operações únicas** — lógica de uma tela fica na própria tela
- **Não abstraia prematuramente** — dois componentes similares não precisam de um componente-pai compartilhado até que haja três ou mais
- **Não adicione `useEffect` para sincronizar estado derivado** — compute diretamente
- **Não use `axios` para SSE** — axios não suporta `ReadableStream` corretamente; use `fetch`
- **Não importe lucide-react inteiro** — importe apenas os ícones usados: `import { Zap } from 'lucide-react'`
- **Não edite `components/ui/`** — são componentes shadcn gerados; substitua pelo mecanismo do shadcn se precisar atualizar
- **Não use `default export`** em componentes — dificulta refatoração e tree-shaking
- **Não duplique lógica de skill picker** — `HomeInput` e `ChatInput` seguem o mesmo padrão; se precisar mudar, mude os dois

---

## Comandos

```bash
# Desenvolvimento
cd web && npm run dev        # Vite dev server (porta 5173)

# Build de produção
npm run build                # tsc + vite build

# Lint
npm run lint                 # eslint com react-hooks plugin
```

Variáveis de ambiente (arquivo `.env` em `web/`):
```
VITE_API_BASE_URL=http://localhost:8000
```
