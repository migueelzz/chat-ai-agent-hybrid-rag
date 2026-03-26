import { useEffect, useRef } from 'react'
import { UserMessage } from './user-message'
import { AssistantMessage } from './assistant-message'
import type { ChatMessage } from '@/lib/types'

interface MessageListProps {
  messages: ChatMessage[]
  onRetry?: () => void
}

export function MessageList({ messages, onRetry }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
            />
          ),
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
