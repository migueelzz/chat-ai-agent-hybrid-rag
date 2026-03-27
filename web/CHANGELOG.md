# Changelog — Frontend

Todas as mudanças relevantes do frontend são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)

---

## [não lançado] — 2026-03-26

### Adicionado
- Sistema de Skills: página `/skills` com upload drag & drop de `.md`/`.txt`, lista de skills com toggle ativo/inativo e delete
- Slash command `/nome-da-skill` em `ChatInput` e `HomeInput`: popover filtrável acima do textarea, Tab para autocompletar, skill selecionada vira badge removível
- `SkillMeta` em `lib/types.ts`; funções `getSkills`, `uploadSkill`, `deleteSkill`, `toggleSkill` em `lib/api.ts`
- Rota `/skills` em `app.tsx`; item "Skills" com ícone `Zap` na `nav-sidebar.tsx`
- Suporte a `skillName` em `use-chat.ts` → `sendMessage(text, files?, skillName?)` → passado no body do POST
- Badge `use_skill` no `tool-badge.tsx` com ícone Zap e label "Aplicando skill especializada"
- Badge `scrape_url` no `tool-badge.tsx`

### Alterado
- `AssistantMessage`: `<SourcesPanel>` movido para **abaixo** do conteúdo (era acima)
- `UserMessage`: badges de anexos movidos para **abaixo** da bolha de mensagem
- `ChatInput`: prop `onSend` alterada para `(text, skillName?) => void`; adicionado suporte a skill picker
- `HomeInput`: adicionado suporte a skill picker (mesma lógica do `ChatInput`)
- `chat-page.tsx`: carrega skills via `getSkills()` e passa para `ChatInput`; lê `skillName` do navigation state
- `home-page.tsx`: carrega skills via `getSkills()` e passa para `HomeInput`; repassa `skillName` no navigate state
- `use-chat.ts` / `loadHistory()`: strip do prefixo `[Contexto de arquivos...]` injetado pelo backend; session files atribuídos à primeira mensagem humana com prefixo

### Corrigido
- Histórico exibindo conteúdo de arquivos TXT como texto da mensagem do usuário
- Skill picker fechando antes de registrar o clique (corrigido com `onMouseDown + e.preventDefault()`)
