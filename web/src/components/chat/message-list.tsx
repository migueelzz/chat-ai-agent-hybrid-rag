import { useEffect, useRef } from 'react'
import { UserMessage } from './user-message'
import { AssistantMessage } from './assistant-message'
import type { ChatMessage } from '@/lib/types'

interface MessageListProps {
  messages: ChatMessage[]
  onRetry?: () => void
  thinkingEnabled?: boolean
  onExtractDocument?: (content: string) => Promise<string>
  onSendNextStep?: (skillName: string) => void
}

export function MessageList({ messages, onRetry, thinkingEnabled = true, onExtractDocument, onSendNextStep }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Accumulated document: conteúdo de todas as mensagens is_document não-streaming
  const documentContents = messages
    .filter((m) => m.role === 'assistant' && m.isDocument && !m.isStreaming && m.content)
    .map((m) => m.content)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {messages.map((msg, idx) =>
          msg.role === 'human' ? (
            <UserMessage key={msg.id} content={msg.content} attachments={msg.attachments} />
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              onRetry={idx === messages.length - 1 ? onRetry : undefined}
              thinkingEnabled={thinkingEnabled}
              onExtractDocument={onExtractDocument}
              onSendNextStep={onSendNextStep}
              accumulatedDocument={
                // Mostra download combinado na última fase (nextSkill=null + múltiplas fases concluídas)
                msg.isDocument && !msg.isStreaming && !msg.nextSkill && documentContents.length > 1
                  ? documentContents.join('\n\n---\n\n')
                  : undefined
              }
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
