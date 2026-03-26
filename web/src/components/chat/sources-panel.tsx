import { FileText, ExternalLink } from 'lucide-react'
import type { Source, ToolCall } from '@/lib/types'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extractSources(toolCalls: ToolCall[]): Source[] {
  const sources: Source[] = []
  const seenFilenames = new Set<string>()
  const seenUrls = new Set<string>()

  for (const tc of toolCalls) {
    if (!tc.output) continue

    if (tc.name === 'rag_search') {
      // Tentar parsear metadados estruturados primeiro
      const metaMatch = tc.output.match(/<!--SOURCES_META:(.+?)-->/)
      if (metaMatch) {
        try {
          const meta = JSON.parse(metaMatch[1]) as Array<{
            id: number | null
            filename: string
            size: number
          }>
          for (const s of meta) {
            if (!s.filename || seenFilenames.has(s.filename)) continue
            seenFilenames.add(s.filename)
            sources.push({
              type: 'doc',
              label: s.filename,
              filename: s.filename,
              sizeBytes: s.size || 0,
            })
          }
          continue // não cair no fallback
        } catch {
          // fallback abaixo
        }
      }

      // Fallback: extrair headings ### do output
      const headings = tc.output.matchAll(/^#{1,3}\s+(.+)$/gm)
      for (const m of headings) {
        const title = m[1].trim()
        if (!seenFilenames.has(title) && !title.startsWith('Consulta')) {
          seenFilenames.add(title)
          sources.push({ type: 'doc', label: title })
        }
      }
    }

    if (tc.name === 'web_search' || tc.name === 'scrape_url') {
      const urls = tc.output.matchAll(/https?:\/\/[^\s\])"]+/g)
      for (const m of urls) {
        const url = m[0].replace(/[.,;!?]$/, '')
        if (!seenUrls.has(url)) {
          seenUrls.add(url)
          try {
            const host = new URL(url).hostname.replace(/^www\./, '')
            sources.push({ type: 'web', label: host, url })
          } catch {
            sources.push({ type: 'web', label: url, url })
          }
        }
      }
    }
  }

  return sources
}

interface SourcesPanelProps {
  toolCalls: ToolCall[]
}

export function SourcesPanel({ toolCalls }: SourcesPanelProps) {
  const sources = extractSources(toolCalls)
  if (sources.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {sources.map((src, i) =>
        src.type === 'doc' ? (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground"
            title={src.filename}
          >
            <FileText className="size-3 shrink-0 text-sidebar-primary/70" />
            <span className="max-w-45 truncate">{src.filename || src.label}</span>
            {src.sizeBytes ? (
              <span className="text-muted-foreground/50">· {formatBytes(src.sizeBytes)}</span>
            ) : null}
          </div>
        ) : (
          <a
            key={i}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <ExternalLink className="size-3 shrink-0 text-sidebar-primary/70" />
            <span className="max-w-45 truncate">{src.label}</span>
          </a>
        ),
      )}
    </div>
  )
}
