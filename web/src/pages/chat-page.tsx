import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { Pencil, Check, X } from 'lucide-react'
import { useChat } from '@/hooks/use-chat'
import { useSessions } from '@/hooks/use-sessions'
import { MessageList } from '@/components/chat/message-list'
import { ChatInput } from '@/components/chat/chat-input'
import { downloadOutputZip, extractDocument, getSkills } from '@/lib/api'
import { getThinkingEnabled, setThinkingEnabled, getWebSearchEnabled, setWebSearchEnabled } from '@/lib/prefs'
import { getSessions } from '@/lib/sessions'
import type { SkillMeta } from '@/lib/types'

interface LocationState {
  firstMessage?: string
  pendingFiles?: File[]
  skillNames?: string[]
  webSearchEnabled?: boolean
}

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const location = useLocation()
  const state = location.state as LocationState | null
  const {
    messages,
    isStreaming,
    isBlocked,
    pendingFiles,
    sendMessage,
    sendNextStep,
    loadHistory,
    loadAttachments,
    stopStreaming,
    retryLast,
    addPendingFile,
    removePendingFile,
  } = useChat(sessionId ?? '')
  const { renameSession } = useSessions()
  const sentRef = useRef(false)
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [thinkingEnabled, setThinkingEnabledState] = useState(getThinkingEnabled)
  const [webSearchEnabled, setWebSearchEnabledState] = useState(getWebSearchEnabled)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getSkills().then(setSkills).catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionId) return

    if (state?.firstMessage && !sentRef.current) {
      sentRef.current = true
      void sendMessage(state.firstMessage, state.pendingFiles ?? [], state.skillNames ?? undefined, state.webSearchEnabled ?? true)
    } else if (!state?.firstMessage) {
      void loadHistory()
      void loadAttachments()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  const handleExtractDocument = useCallback(
    (content: string) => extractDocument(sessionId!, content),
    [sessionId],
  )

  const toggleThinking = () => {
    const next = !thinkingEnabled
    setThinkingEnabledState(next)
    setThinkingEnabled(next)
  }

  const toggleWebSearch = () => {
    const next = !webSearchEnabled
    setWebSearchEnabledState(next)
    setWebSearchEnabled(next)
  }

  const startRename = () => {
    if (!sessionId) return
    const session = getSessions().find((s) => s.id === sessionId)
    const current = session?.customTitle ?? session?.title ?? messages.find((m) => m.role === 'human')?.content?.slice(0, 60) ?? ''
    setRenameValue(current)
    setIsRenaming(true)
  }

  const confirmRename = () => {
    if (sessionId) renameSession(sessionId, renameValue)
    setIsRenaming(false)
  }

  const cancelRename = () => setIsRenaming(false)

  // Resolve display title: customTitle > title > first message content
  const displayTitle = (() => {
    if (!sessionId) return 'Nova conversa'
    const session = getSessions().find((s) => s.id === sessionId)
    if (session?.customTitle) return session.customTitle
    if (session?.title) return session.title
    return messages.find((m) => m.role === 'human')?.content?.slice(0, 60) ?? 'Nova conversa'
  })()

  if (!sessionId) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        {isRenaming ? (
          <>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename()
                if (e.key === 'Escape') cancelRename()
              }}
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none border-b border-border/60 focus:border-sidebar-primary/60"
              maxLength={100}
            />
            <button onClick={confirmRename} className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Confirmar">
              <Check className="size-3.5" />
            </button>
            <button onClick={cancelRename} className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Cancelar">
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <p className="truncate text-sm text-muted-foreground flex-1 min-w-0">
              {displayTitle}
            </p>
            <button
              onClick={startRename}
              className="shrink-0 p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Renomear conversa"
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
      </div>

      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        onRetry={retryLast}
        thinkingEnabled={thinkingEnabled}
        onExtractDocument={handleExtractDocument}
        onSendNextStep={(skillName) => sendNextStep(skillName, webSearchEnabled)}
        onDownloadZip={() => void downloadOutputZip(sessionId!)}
      />

      <ChatInput
        onSend={(text, skillNames, wsEnabled) => void sendMessage(text, undefined, skillNames, wsEnabled)}
        onStop={stopStreaming}
        disabled={isStreaming}
        isBlocked={isBlocked}
        isStreaming={isStreaming}
        pendingFiles={pendingFiles}
        onAddFile={addPendingFile}
        onRemoveFile={removePendingFile}
        skills={skills}
        thinkingEnabled={thinkingEnabled}
        onThinkingToggle={toggleThinking}
        webSearchEnabled={webSearchEnabled}
        onWebSearchToggle={toggleWebSearch}
      />
    </div>
  )
}
