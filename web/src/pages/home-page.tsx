import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSession, getSkills } from '@/lib/api'
import { addSession } from '@/lib/sessions'
import { HomeInput } from '@/components/home/home-input'
import { SuggestionChips } from '@/components/home/suggestion-chips'
import type { SkillMeta } from '@/lib/types'

export function HomePage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [skills, setSkills] = useState<SkillMeta[]>([])

  useEffect(() => {
    getSkills().then(setSkills).catch(() => {})
  }, [])

  const handleSubmit = async (text: string, files?: File[], skillName?: string) => {
    if (loading) return
    setLoading(true)
    try {
      const { session_id, created_at } = await createSession()
      addSession(session_id, text, created_at)
      navigate(`/chat/${session_id}`, {
        state: { firstMessage: text, pendingFiles: files ?? [], skillName: skillName ?? null },
      })
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-2">
        {/* Greeting */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Olá, como posso ajudar?
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assistente SAP especializado
          </p>
        </div>

        <HomeInput onSubmit={handleSubmit} loading={loading} skills={skills} />
        <SuggestionChips onSelect={handleSubmit} />
      </div>
    </div>
  )
}
