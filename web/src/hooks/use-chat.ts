import { useCallback, useRef, useState } from 'react'
import { getHistory, streamMessage, uploadAttachment, getAttachments } from '@/lib/api'
import type { AttachmentMeta, ChatMessage, ToolCall } from '@/lib/types'

function uuid() {
  return crypto.randomUUID()
}

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const lastUserTextRef = useRef<string>('')

  const loadHistory = useCallback(async () => {
    try {
      const [history, sessionFiles] = await Promise.all([
        getHistory(sessionId),
        getAttachments(sessionId).catch(() => [] as AttachmentMeta[]),
      ])
      const result: ChatMessage[] = []
      let i = 0
      let filesAssigned = false

      while (i < history.messages.length) {
        const msg = history.messages[i]

        if (msg.role === 'human') {
          // Strip injected file-context prefix stored by _stream_agent()
          const PREFIX_MARKER = '\n\nPergunta do usuário: '
          let content = msg.content
          let msgAttachments: AttachmentMeta[] | undefined

          if (content.startsWith('[Contexto de arquivos enviados pelo usuário nesta sessão]')) {
            const markerIdx = content.indexOf(PREFIX_MARKER)
            if (markerIdx !== -1) {
              content = content.slice(markerIdx + PREFIX_MARKER.length)
            }
            // Attach session files to the first human message that carried the prefix
            if (!filesAssigned && sessionFiles.length > 0) {
              msgAttachments = sessionFiles
              filesAssigned = true
            }
          }

          result.push({ id: uuid(), role: 'human', content, attachments: msgAttachments })
          i++
        } else if (msg.role === 'assistant') {
          const toolCalls: ToolCall[] = []
          i++
          while (i < history.messages.length && history.messages[i].role === 'tool') {
            toolCalls.push({ id: uuid(), name: 'rag_search', status: 'done' })
            i++
          }
          result.push({
            id: uuid(),
            role: 'assistant',
            content: msg.content,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        } else {
          i++
        }
      }

      setMessages(result)
    } catch {
      // sessão nova ou sem histórico
    }
  }, [sessionId])

  const loadAttachments = useCallback(async () => {
    const list = await getAttachments(sessionId)
    setAttachments(list)
  }, [sessionId])

  const addPendingFile = useCallback((file: File) => {
    setPendingFiles((prev) => {
      if (prev.some((f) => f.name === file.name)) return prev
      return [...prev, file]
    })
  }, [])

  const removePendingFile = useCallback((filename: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== filename))
  }, [])

  const sendMessage = useCallback(
    async (text: string, initialFiles?: File[]) => {
      if (isStreaming) return

      lastUserTextRef.current = text

      // Fazer upload dos arquivos pendentes primeiro (pendingFiles do estado + initialFiles opcionais)
      const allPendingFiles = [...(initialFiles ?? []), ...pendingFiles]
      const uploadedFiles: AttachmentMeta[] = []
      for (const file of allPendingFiles) {
        try {
          const meta = await uploadAttachment(sessionId, file)
          uploadedFiles.push(meta)
        } catch {
          // continua mesmo se um arquivo falhar
        }
      }
      if (uploadedFiles.length > 0) {
        setAttachments((prev) => [...prev, ...uploadedFiles])
        setPendingFiles([])
      }

      const assistantId = uuid()
      const startTime = Date.now()

      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: 'human', content: text, attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined },
        { id: assistantId, role: 'assistant', content: '', toolCalls: [], isStreaming: true },
      ])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      let currentContent = ''
      let currentThinking = ''
      let currentTools: ToolCall[] = []

      try {
        for await (const chunk of streamMessage(sessionId, text, controller.signal)) {
          if (chunk.type === 'token') {
            currentContent += chunk.content
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: currentContent } : m)),
            )
          } else if (chunk.type === 'thinking') {
            currentThinking += chunk.content
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, thinkingContent: currentThinking } : m)),
            )
          } else if (chunk.type === 'tool_start' && chunk.tool_name) {
            currentTools = [...currentTools, { id: uuid(), name: chunk.tool_name, status: 'running' }]
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: currentTools } : m)),
            )
          } else if (chunk.type === 'tool_end' && chunk.tool_name) {
            let patched = false
            currentTools = currentTools.map((tc) => {
              if (!patched && tc.name === chunk.tool_name && tc.status === 'running') {
                patched = true
                return { ...tc, status: 'done' as const, output: chunk.content }
              }
              return tc
            })
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: currentTools } : m)),
            )
          } else if (chunk.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: chunk.content || 'Erro ao processar resposta.', hasError: true }
                  : m,
              ),
            )
            break
          } else if (chunk.type === 'done') {
            break
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: 'Erro de conexão com o servidor.', hasError: true }
                : m,
            ),
          )
        }
      } finally {
        const elapsedMs = Date.now() - startTime
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false, elapsedMs } : m)),
        )
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [sessionId, isStreaming, pendingFiles],
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retryLast = useCallback(() => {
    if (isStreaming) return
    const lastText = lastUserTextRef.current
    if (!lastText) return
    // Remove a última mensagem do assistente antes de reenviar
    setMessages((prev) => {
      const lastAssistant = [...prev].reverse().findIndex((m) => m.role === 'assistant')
      if (lastAssistant === -1) return prev
      const idx = prev.length - 1 - lastAssistant
      return prev.slice(0, idx)
    })
    void sendMessage(lastText)
  }, [isStreaming, sendMessage])

  return {
    messages,
    isStreaming,
    attachments,
    pendingFiles,
    sendMessage,
    loadHistory,
    loadAttachments,
    stopStreaming,
    retryLast,
    addPendingFile,
    removePendingFile,
  }
}
