import axios from 'axios'
import type { AttachmentMeta, CreateSessionResponse, DailyCalls, ErrorLog, HistoryResponse, MessageChunk, MetricsSummary, ProviderBudget, SkillMeta, ZipUploadResponse } from './types'

const baseURL = '/api'

const http = axios.create({
  baseURL: baseURL,
})

export async function createSession(): Promise<CreateSessionResponse> {
  const { data } = await http.post<CreateSessionResponse>('/chat/sessions')
  return data
}

export async function getHistory(sessionId: string): Promise<HistoryResponse> {
  const { data } = await http.get<HistoryResponse>(`/chat/${sessionId}/history`)
  return data
}

export async function deleteSessionApi(sessionId: string): Promise<void> {
  await http.delete(`/chat/${sessionId}`)
}

export async function deleteSessionsBulk(ids: string[]): Promise<void> {
  await http.post('/chat/sessions/bulk-delete', { session_ids: ids })
}

export async function uploadAttachment(sessionId: string, file: File): Promise<AttachmentMeta> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<AttachmentMeta>(`/chat/${sessionId}/attachments`, form)
  return data
}

export async function uploadZipAttachment(sessionId: string, file: File): Promise<ZipUploadResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<ZipUploadResponse>(`/chat/${sessionId}/zip-attachment`, form)
  return data
}

export async function getAttachments(sessionId: string): Promise<AttachmentMeta[]> {
  try {
    const { data } = await http.get<AttachmentMeta[]>(`/chat/${sessionId}/attachments`)
    return data
  } catch {
    return []
  }
}

export async function getSkills(): Promise<SkillMeta[]> {
  const { data } = await http.get<SkillMeta[]>('/skills/')
  return data
}

export async function uploadSkill(file: File): Promise<SkillMeta> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<SkillMeta>('/skills/', form)
  return data
}

export async function deleteSkill(id: number): Promise<void> {
  await http.delete(`/skills/${id}`)
}

export async function toggleSkill(id: number): Promise<SkillMeta> {
  const { data } = await http.patch<SkillMeta>(`/skills/${id}/toggle`)
  return data
}

export async function extractDocument(sessionId: string, content: string): Promise<string> {
  const { data } = await http.post<{ document: string }>(`/chat/${sessionId}/extract-document`, { content })
  return data.document
}

export async function getMetricsCalls(days: number): Promise<DailyCalls[]> {
  try {
    const { data } = await http.get<DailyCalls[]>('/metrics/usage', { params: { days } })
    return data
  } catch {
    return []
  }
}

export async function getMetricsSummary(days: number): Promise<MetricsSummary> {
  const { data } = await http.get<MetricsSummary>('/metrics/summary', { params: { days } })
  return data
}

export async function getMetricsBudget(): Promise<ProviderBudget[]> {
  try {
    const { data } = await http.get<ProviderBudget[]>('/metrics/provider')
    return data
  } catch {
    return []
  }
}

export async function getMetricsErrors(limit = 50): Promise<ErrorLog[]> {
  try {
    const { data } = await http.get<ErrorLog[]>('/metrics/errors', { params: { limit } })
    return data
  } catch {
    return []
  }
}

// SSE streaming usa fetch (axios não suporta ReadableStream com async generator)
export async function* streamMessage(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  skillNames?: string[],
  webSearchEnabled?: boolean,
): AsyncGenerator<MessageChunk> {
  const res = await fetch(`${baseURL}/chat/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      skill_names: skillNames ?? [],
      web_search_enabled: webSearchEnabled ?? true,
    }),
    signal,
  })

  if (!res.ok) throw new Error(`Erro na requisição: ${res.status}`)
  if (!res.body) throw new Error('Sem corpo na resposta')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      try {
        yield JSON.parse(line.slice(6)) as MessageChunk
      } catch {
        // ignora linhas mal formadas
      }
    }
  }
}
