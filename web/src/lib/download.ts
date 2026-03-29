import { marked } from 'marked'

function filenameFromContent(content: string): string {
  const match = /^#+ (.+)/m.exec(content)
  const title = match ? match[1].trim() : 'resposta-agente'
  return title
    .replace(/[^a-zA-Z0-9À-ú\s\-_]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadAsMarkdown(content: string): void {
  const filename = filenameFromContent(content)
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  triggerBlobDownload(blob, `${filename}.md`)
}

export async function downloadAsPdf(content: string): Promise<void> {
  const filename = filenameFromContent(content)
  const bodyHtml = await marked.parse(content, { gfm: true, breaks: false })

  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) return

  printWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; font-size: 14px; }
    h1, h2, h3, h4 { margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; }
    h1 { font-size: 1.75em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.2em; }
    p { margin: 0.75em 0; }
    code { background: #f4f4f5; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: 'SFMono-Regular', Consolas, monospace; }
    pre { background: #1e1e2e; color: #cdd6f4; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
    pre code { background: none; padding: 0; font-size: 0.82em; color: inherit; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #d1d5db; padding: 6px 12px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    blockquote { border-left: 4px solid #e5e7eb; margin: 1em 0; padding: 0.5em 1em; color: #6b7280; }
    ul, ol { padding-left: 1.5em; margin: 0.75em 0; }
    li { margin: 0.25em 0; }
    a { color: #2563eb; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
    @media print { body { margin: 0; } pre { white-space: pre-wrap; word-break: break-all; } }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`)

  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 250)
}
