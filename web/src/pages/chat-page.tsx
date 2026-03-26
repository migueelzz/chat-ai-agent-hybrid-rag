import { useEffect, useRef, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useChat } from '@/hooks/use-chat'
import { MessageList } from '@/components/chat/message-list'
import { ChatInput } from '@/components/chat/chat-input'
import { getSkills } from '@/lib/api'
import type { SkillMeta } from '@/lib/types'

interface LocationState {
  firstMessage?: string
  pendingFiles?: File[]
  skillName?: string | null
}

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const location = useLocation()
  const state = location.state as LocationState | null
  const {
    messages,
    isStreaming,
    pendingFiles,
    sendMessage,
    loadHistory,
    loadAttachments,
    stopStreaming,
    retryLast,
    addPendingFile,
    removePendingFile,
  } = useChat(sessionId ?? '')
  const sentRef = useRef(false)
  const [skills, setSkills] = useState<SkillMeta[]>([])

  useEffect(() => {
    getSkills().then(setSkills).catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionId) return

    if (state?.firstMessage && !sentRef.current) {
      sentRef.current = true
      void sendMessage(state.firstMessage, state.pendingFiles ?? [], state.skillName ?? undefined)
    } else if (!state?.firstMessage) {
      void loadHistory()
      void loadAttachments()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (!sessionId) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-border px-6 py-3">
        <p className="truncate text-sm text-muted-foreground">
          {messages.find((m) => m.role === 'human')?.content?.slice(0, 60) ?? 'Nova conversa'}
        </p>
      </div>

      <MessageList messages={messages} onRetry={retryLast} />

      <ChatInput
        onSend={(text, skillName) => void sendMessage(text, undefined, skillName)}
        onStop={stopStreaming}
        disabled={isStreaming}
        isStreaming={isStreaming}
        pendingFiles={pendingFiles}
        onAddFile={addPendingFile}
        onRemoveFile={removePendingFile}
        skills={skills}
      />
    </div>
  )
}
