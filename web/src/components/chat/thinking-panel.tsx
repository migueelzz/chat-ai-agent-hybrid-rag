import { useState, useEffect } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ToolBadge } from './tool-badge'
import type { ToolCall } from '@/lib/types'

interface ThinkingPanelProps {
  toolCalls: ToolCall[]
  thinkingContent?: string
  isStreaming: boolean
}

export function ThinkingPanel({ toolCalls, thinkingContent, isStreaming }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false)

  const hasThinking = !!thinkingContent
  const hasTools = toolCalls.length > 0
  const hasContent = hasThinking || hasTools

  // Abre automaticamente durante o streaming quando há conteúdo
  useEffect(() => {
    if (isStreaming && hasContent) setOpen(true)
  }, [isStreaming, hasContent])

  if (!hasContent) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
        <Brain className="size-3.5 text-sidebar-primary/70 group-hover:text-sidebar-primary" />
        <span>Raciocínio do agente</span>
        {open ? (
          <ChevronDown className="size-3 transition-transform" />
        ) : (
          <ChevronRight className="size-3 transition-transform" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-2">
        {/* Texto de raciocínio do modelo (thinking tokens) */}
        {hasThinking && (
          <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground/70 mb-1">Pensamento</p>
            <p className="text-xs text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">
              {thinkingContent}
            </p>
          </div>
        )}

        {/* Ferramentas utilizadas */}
        {hasTools && (
          <div className="flex flex-col gap-1.5">
            {hasThinking && (
              <p className="text-xs font-medium text-muted-foreground/70">Ferramentas</p>
            )}
            {toolCalls.map((tc) => (
              <ToolBadge key={tc.id} tool={tc} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
