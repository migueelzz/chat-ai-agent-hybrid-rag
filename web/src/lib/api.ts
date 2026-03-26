import axios from 'axios'
import type { AttachmentMeta, CreateSessionResponse, HistoryResponse, MessageChunk, SkillMeta } from './types'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string,
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

export async function uploadAttachment(sessionId: string, file: File): Promise<AttachmentMeta> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<AttachmentMeta>(`/chat/${sessionId}/attachments`, form)
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

// SSE streaming usa fetch (axios não suporta ReadableStream com async generator)
export async function* streamMessage(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  skillName?: string,
): AsyncGenerator<MessageChunk> {
  const base = import.meta.env.VITE_API_BASE_URL as string
  const res = await fetch(`${base}/chat/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, skill_name: skillName ?? null }),
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
