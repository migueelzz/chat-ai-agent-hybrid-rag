import type { Session, SessionMeta } from './types'

const STORAGE_KEY = 'atem_sessions'

export function getSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Session[]
  } catch {
    return []
  }
}

export function addSession(id: string, title: string, createdAt: string): void {
  const sessions = getSessions().filter((s) => s.id !== id)
  const truncated = title.length > 60 ? title.slice(0, 60) + '…' : title
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([{ id, title: truncated, createdAt }, ...sessions]),
  )
}

export function removeSession(id: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(getSessions().filter((s) => s.id !== id)),
  )
}

export function renameSession(id: string, customTitle: string): void {
  const sessions = getSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return
  sessions[idx] = { ...sessions[idx], customTitle: customTitle.trim() || undefined }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function togglePin(id: string): void {
  const sessions = getSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return
  sessions[idx] = { ...sessions[idx], pinned: !sessions[idx].pinned }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

/** Sobrescreve o cache local com os dados vindos do backend. */
export function syncSessionsFromBackend(remoteSessions: SessionMeta[]): Session[] {
  const synced: Session[] = remoteSessions.map((s) => ({
    id: s.id,
    title: s.title,
    customTitle: s.custom_title ?? undefined,
    pinned: s.pinned || undefined,
    createdAt: s.created_at,
  }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(synced))
  return synced
}

export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Hoje'
  if (diffDays === 1) return 'Ontem'
  if (diffDays < 7) return `${diffDays} dias atrás`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} sem. atrás`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
