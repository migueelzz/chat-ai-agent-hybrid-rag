import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { ThinkingPanel } from './thinking-panel'
import { SourcesPanel } from './sources-panel'
import type { ChatMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

interface AssistantMessageProps {
  message: ChatMessage
  onRetry?: () => void
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      title="Copiar"
      className="rounded p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function AssistantMessage({ message, onRetry }: AssistantMessageProps) {
  const { content, toolCalls = [], thinkingContent, isStreaming = false, hasError, elapsedMs } = message

  // Timer em tempo real durante o streaming
  const [liveElapsed, setLiveElapsed] = useState(0)
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!isStreaming) {
      setLiveElapsed(0)
      return
    }
    startRef.current = Date.now()
    const id = setInterval(() => setLiveElapsed(Date.now() - startRef.current), 100)
    return () => clearInterval(id)
  }, [isStreaming])

  // Estado de loading inicial: streaming mas sem content, thinking ou tools ainda
  const isLoadingInitial = isStreaming && !content && !thinkingContent && toolCalls.length === 0

  return (
    <div className="group flex flex-col gap-0 max-w-[85%]">
      <ThinkingPanel toolCalls={toolCalls} thinkingContent={thinkingContent} isStreaming={isStreaming} />

      {/* Spinner de loading inicial */}
      {isLoadingInitial && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="size-3.5 animate-spin text-sidebar-primary/70" />
          <span>Gerando resposta…</span>
          <span className="text-muted-foreground/40">{formatElapsed(liveElapsed)}</span>
        </div>
      )}

      {/* Erro */}
      {hasError && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>Erro ao gerar resposta.</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="ml-auto flex items-center gap-1 font-medium hover:underline"
            >
              <RefreshCw className="size-3" />
              Tentar novamente
            </button>
          )}
        </div>
      )}

      {content && (
        <div className="prose-chat text-sm">
          <div className={cn(isStreaming && 'streaming-cursor')}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className ?? '')
                  const isInline = !match
                  return isInline ? (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  ) : (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.82rem' }}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  )
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Badges de fontes — abaixo do conteúdo da resposta */}
      <SourcesPanel toolCalls={toolCalls} />

      {/* Footer: timer sempre visível + ações no hover */}
      {(content || hasError || (!isLoadingInitial && isStreaming)) && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="flex items-center gap-1 transition-opacity">
            {content && !hasError && (
              <>
                <CopyButton text={content} />
                {!isStreaming && onRetry && (
                  <button
                    onClick={onRetry}
                    title="Tentar novamente"
                    className="rounded p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Timer: sempre visível */}
          {isStreaming && (
            <span className="text-[10px] text-muted-foreground/50 ml-1">
              {formatElapsed(liveElapsed)}
            </span>
          )}
          {!isStreaming && elapsedMs !== undefined && elapsedMs > 0 && (
            <span className="text-[10px] text-muted-foreground/50 ml-1">
              Respondido em {formatElapsed(elapsedMs)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
