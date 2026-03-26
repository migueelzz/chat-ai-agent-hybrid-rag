import { useState } from 'react'
import { Copy, Check, FileText } from 'lucide-react'
import type { AttachmentMeta } from '@/lib/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface UserMessageProps {
  content: string
  attachments?: AttachmentMeta[]
}

export function UserMessage({ content, attachments }: UserMessageProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group flex flex-col items-end gap-1.5">
      {/* Arquivos enviados com esta pergunta — abaixo do balão */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
            >
              <FileText className="size-3 shrink-0 text-sidebar-primary/70" />
              <span className="max-w-36 truncate">{att.filename}</span>
              <span className="text-muted-foreground/50">· {formatBytes(att.size_bytes)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Balão da mensagem + botão copiar */}
      <div className="flex flex-col items-end gap-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-sm text-foreground whitespace-pre-wrap">
          {content}
        </div>
        <button
          onClick={handleCopy}
          title="Copiar"
          className="cursor-pointer mb-1 rounded p-1 text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-muted-foreground transition-all"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
