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
  // Dynamic imports para code-splitting — carregam apenas quando o usuário clica em "Baixar PDF"
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])

  const filename = filenameFromContent(content)
  const bodyHtml = await marked.parse(content, { gfm: true, breaks: false })

  // Renderiza em container oculto fora da viewport
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:750px;background:#fff;z-index:-1'
  container.innerHTML = `<div style="
    padding: 40px 48px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1a1a1a;
  ">${bodyHtml}</div>`

  // Estilos inline para o conteúdo HTML gerado pelo marked
  const style = document.createElement('style')
  style.textContent = `
    h1 { font-size: 1.75em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; margin: 1.5em 0 0.5em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.2em; margin: 1.5em 0 0.5em; }
    h3, h4 { font-size: 1.1em; margin: 1.2em 0 0.4em; }
    p { margin: 0.75em 0; }
    code { background: #f4f4f5; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: 'SFMono-Regular', Consolas, monospace; }
    pre { background: #1e1e2e; color: #cdd6f4; padding: 1em; border-radius: 8px; overflow: hidden; margin: 1em 0; }
    pre code { background: none; padding: 0; font-size: 0.82em; color: inherit; white-space: pre-wrap; word-break: break-all; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #d1d5db; padding: 6px 12px; text-align: left; font-size: 0.9em; }
    th { background: #f9fafb; font-weight: 600; }
    blockquote { border-left: 4px solid #e5e7eb; margin: 1em 0; padding: 0.5em 1em; color: #6b7280; }
    ul, ol { padding-left: 1.5em; margin: 0.75em 0; }
    li { margin: 0.25em 0; }
    a { color: #2563eb; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
  `
  container.appendChild(style)
  document.body.appendChild(container)

  try {
    const inner = container.firstElementChild as HTMLElement
    const canvas = await html2canvas(inner, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * imgW) / canvas.width

    // Paginação automática para documentos longos
    let y = 0
    while (y < imgH) {
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -y, imgW, imgH)
      y += pageH
      if (y < imgH) pdf.addPage()
    }

    pdf.save(`${filename}.pdf`)
  } finally {
    document.body.removeChild(container)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  triggerBlobDownload(blob, filename)
}
