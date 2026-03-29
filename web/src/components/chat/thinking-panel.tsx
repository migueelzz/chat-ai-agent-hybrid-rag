import { useState, useEffect } from 'react'
import { Brain, ChevronDown, ChevronRight, MessageSquare, Wrench } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ToolBadge } from './tool-badge'
import type { ToolCall } from '@/lib/types'

interface ThinkingPanelProps {
  toolCalls: ToolCall[]
  thinkingContent?: string
  isStreaming: boolean
  visible?: boolean
}

export function ThinkingPanel({ toolCalls, thinkingContent, isStreaming, visible = true }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false)

  const hasThinking = !!thinkingContent
  const hasTools = toolCalls.length > 0
  const hasContent = hasThinking || hasTools

  useEffect(() => {
    if (isStreaming && hasContent) setOpen(true)
  }, [isStreaming, hasContent])

  if (!visible || !hasContent) return null

  const runningCount = toolCalls.filter((t) => t.status === 'running').length
  const doneCount = toolCalls.filter((t) => t.status === 'done').length

  function getSummary() {
    const parts: string[] = []
    if (hasThinking) parts.push('pensamento')
    if (hasTools) {
      if (runningCount > 0) parts.push(`${runningCount} ação em andamento`)
      else parts.push(`${doneCount} ${doneCount === 1 ? 'ação' : 'ações'}`)
    }
    return parts.join(' · ')
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Brain className="size-3.5 text-sidebar-primary/60 group-hover:text-sidebar-primary transition-colors" />
        <span className="font-medium">Pensamento do agente</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground/55">{getSummary()}</span>
        {open ? (
          <ChevronDown className="size-3 ml-0.5" />
        ) : (
          <ChevronRight className="size-3 ml-0.5" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2">
        <div className="rounded-xl border border-border/30 bg-muted/5 overflow-hidden divide-y divide-border/20">

          {/* Seção: Pensamento do modelo (thinking tokens) */}
          {hasThinking && (
            <div className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="size-3 text-muted-foreground/40" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">
                  Pensamento
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/65 italic whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {thinkingContent}
              </p>
            </div>
          )}

          {/* Seção: Ações / ferramentas utilizadas */}
          {hasTools && (
            <div className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Wrench className="size-3 text-muted-foreground/40" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">
                  Ações
                  {runningCount > 0 && (
                    <span className="ml-1.5 text-sidebar-primary/60 font-normal normal-case">
                      em andamento…
                    </span>
                  )}
                </p>
              </div>
              <div className="space-y-1.5">
                {toolCalls.map((tc) => (
                  <ToolBadge key={tc.id} tool={tc} />
                ))}
              </div>
            </div>
          )}

        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
