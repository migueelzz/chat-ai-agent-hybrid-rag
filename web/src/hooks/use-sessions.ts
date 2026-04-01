import { useCallback, useEffect, useState } from 'react'
import { deleteSessionApi, deleteSessionsBulk, listSessions, patchSession, upsertSession } from '@/lib/api'
import {
  addSession as addSessionStore,
  getSessions,
  removeSession as removeSessionStore,
  renameSession as renameSessionStore,
  syncSessionsFromBackend,
  togglePin as togglePinStore,
} from '@/lib/sessions'
import type { Session } from '@/lib/types'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(() => getSessions())

  // Ao montar: carrega do localStorage imediatamente (UI instantânea),
  // depois sincroniza com o backend e reconcilia
  useEffect(() => {
    void listSessions().then((remote) => {
      if (remote.length > 0) {
        const synced = syncSessionsFromBackend(remote)
        setSessions(synced)
      } else {
        // DB vazio — sincroniza sessões do localStorage com o backend (migração única)
        const local = getSessions()
        for (const s of local) {
          void upsertSession(s.id, {
            title: s.title,
            custom_title: s.customTitle ?? null,
            pinned: s.pinned ?? false,
            created_at: s.createdAt,
          })
        }
      }
    })
  }, [])

  const addSession = useCallback((id: string, title: string, createdAt: string) => {
    addSessionStore(id, title, createdAt)
    setSessions(getSessions())
    void upsertSession(id, { title, created_at: createdAt })
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    removeSessionStore(id)
    setSessions(getSessions())
    try { await deleteSessionApi(id) } catch { /* best-effort */ }
  }, [])

  const deleteSessions = useCallback(async (ids: string[]) => {
    ids.forEach(removeSessionStore)
    setSessions(getSessions())
    try { await deleteSessionsBulk(ids) } catch { /* best-effort */ }
  }, [])

  const renameSession = useCallback((id: string, customTitle: string) => {
    renameSessionStore(id, customTitle)
    setSessions(getSessions())
    void patchSession(id, { custom_title: customTitle.trim() || null })
  }, [])

  const togglePin = useCallback((id: string) => {
    togglePinStore(id)
    const updated = getSessions()
    setSessions(updated)
    const session = updated.find((s) => s.id === id)
    if (session) {
      void patchSession(id, { pinned: session.pinned ?? false })
    }
  }, [])

  const refresh = useCallback(() => {
    setSessions(getSessions())
  }, [])

  return { sessions, addSession, deleteSession, deleteSessions, renameSession, togglePin, refresh }
}
