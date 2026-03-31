import { useCallback, useState } from 'react'
import { deleteSessionApi, deleteSessionsBulk } from '@/lib/api'
import {
  addSession as addSessionStore,
  getSessions,
  removeSession as removeSessionStore,
  renameSession as renameSessionStore,
  togglePin as togglePinStore,
} from '@/lib/sessions'
import type { Session } from '@/lib/types'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(() => getSessions())

  const addSession = useCallback((id: string, title: string, createdAt: string) => {
    addSessionStore(id, title, createdAt)
    setSessions(getSessions())
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
  }, [])

  const togglePin = useCallback((id: string) => {
    togglePinStore(id)
    setSessions(getSessions())
  }, [])

  const refresh = useCallback(() => {
    setSessions(getSessions())
  }, [])

  return { sessions, addSession, deleteSession, deleteSessions, renameSession, togglePin, refresh }
}
