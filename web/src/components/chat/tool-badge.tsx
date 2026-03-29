import { useState } from 'react'
import { BookOpen, Globe, Loader2, Check, Zap, Link, ChevronDown, FileText, Search, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/lib/types'

const TOOL_META: Record<string, { icon: typeof BookOpen; label: string }> = {
  rag_search: { icon: BookOpen, label: 'Base de conhecimento SAP' },
  web_search: { icon: Globe, label: 'Pesquisa na web' },
  scrape_url: { icon: Link, label: 'Leitura de URL' },
  use_skill: { icon: Zap, label: 'Skill especializada' },
}

interface ToolBadgeProps {
  tool: ToolCall
}

function InputDetail({ tool }: { tool: ToolCall }) {
  const input = tool.toolInput
  if (!input) return null

  if ((tool.name === 'rag_search' || tool.name === 'web_search') && input.query) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/55">
        <Search className="size-2.5 shrink-0" />
        <span className="truncate italic">&ldquo;{input.query}&rdquo;</span>
      </span>
    )
  }
  if (tool.name === 'scrape_url' && input.url) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/55">
        <ExternalLink className="size-2.5 shrink-0" />
        <span className="truncate">{input.url}</span>
      </span>
    )
  }
  if (tool.name === 'use_skill' && input.skill_name) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/55">
        <Zap className="size-2.5 shrink-0" />
        <span className="font-mono">/{input.skill_name}</span>
      </span>
    )
  }
  return null
}

function OutputDetail({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  if (tool.status !== 'done') return null

  // rag_search: lista de documentos consultados
  if (tool.name === 'rag_search' && tool.sourceDocs && tool.sourceDocs.length > 0) {
    return (
      <div className="mt-1 space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/40">
          Documentos consultados
        </p>
        <div className="flex flex-wrap gap-1">
          {tool.sourceDocs.map((doc) => (
            <span
              key={doc.filename}
              className="flex items-center gap-1 rounded border border-border/30 bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground/60"
            >
              <FileText className="size-2.5 shrink-0" />
              {doc.filename}
            </span>
          ))}
        </div>
      </div>
    )
  }

  // web_search: snippet colapsável do resultado
  if (tool.name === 'web_search' && tool.output) {
    const snippet = tool.output.replace(/<!--.*?-->/gs, '').trim().slice(0, 220)
    if (!snippet) return null
    return (
      <div className="mt-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/45 hover:text-muted-foreground/70 transition-colors"
        >
          <ChevronDown className={cn('size-2.5 transition-transform', open && 'rotate-180')} />
          {open ? 'Ocultar resultado' : 'Ver resultado'}
        </button>
        {open && (
          <p className="mt-1 text-[11px] text-muted-foreground/55 leading-relaxed">
            {snippet}
            {tool.output.length > 220 && '…'}
          </p>
        )}
      </div>
    )
  }

  return null
}

export function ToolBadge({ tool }: ToolBadgeProps) {
  const meta = TOOL_META[tool.name] ?? { icon: BookOpen, label: tool.name }
  const Icon = meta.icon
  const running = tool.status === 'running'

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 space-y-0.5',
        running ? 'border-border bg-muted/30' : 'border-border/40 bg-muted/10',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', running ? 'text-muted-foreground' : 'text-muted-foreground/50')} />
        <span className={cn('flex-1 text-xs font-medium', running ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
          {meta.label}
        </span>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-sidebar-primary" />
        ) : (
          <Check className="size-3.5 shrink-0 text-green-500/70" />
        )}
      </div>
      <InputDetail tool={tool} />
      <OutputDetail tool={tool} />
    </div>
  )
}
