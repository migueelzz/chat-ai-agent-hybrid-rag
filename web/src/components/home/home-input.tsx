import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Paperclip, FileText, X, Zap, Brain, Globe, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@/lib/types'

const LONG_TEXT_THRESHOLD = 2000

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface HomeInputProps {
  onSubmit: (text: string, files?: File[], skillNames?: string[], webSearchEnabled?: boolean) => void
  loading?: boolean
  skills?: SkillMeta[]
  thinkingEnabled?: boolean
  onThinkingToggle?: () => void
  webSearchEnabled?: boolean
  onWebSearchToggle?: () => void
}

export function HomeInput({
  onSubmit,
  loading = false,
  skills = [],
  thinkingEnabled = true,
  onThinkingToggle,
  webSearchEnabled = true,
  onWebSearchToggle,
}: HomeInputProps) {
  const [value, setValue] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<SkillMeta[]>([])
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const filteredSkills = skills.filter(
    (s) =>
      s.is_active &&
      (!skillFilter ||
        s.name.toLowerCase().includes(skillFilter) ||
        s.title.toLowerCase().includes(skillFilter)),
  )

  const selectSkill = (skill: SkillMeta) => {
    setValue('')
    setSelectedSkills((prev) => (prev.some((s) => s.id === skill.id) ? prev : [...prev, skill]))
    setShowSkillPicker(false)
    setSkillFilter('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }

  const convertToFile = (rawText?: string) => {
    const text = (rawText ?? value).trim()
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain' })
    const file = new File([blob], `mensagem-${Date.now()}.txt`, { type: 'text/plain' })
    setPendingFiles((prev) => {
      if (prev.some((f) => f.name === file.name)) return prev
      return [...prev, file]
    })
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const submit = () => {
    const text = value.trim()
    if (!text || loading) return
    if (text.length > LONG_TEXT_THRESHOLD) {
      convertToFile()
      return
    }
    const skillNames = selectedSkills.length > 0 ? selectedSkills.map((s) => s.name) : undefined
    setSelectedSkills([])
    setShowSkillPicker(false)
    onSubmit(text, pendingFiles, skillNames, webSearchEnabled)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkillPicker) {
      if (e.key === 'Tab' && filteredSkills.length > 0) {
        e.preventDefault()
        selectSkill(filteredSkills[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkillPicker(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    if (val.trim().length > LONG_TEXT_THRESHOLD) {
      convertToFile(val)
      return
    }
    setValue(val)
    if (val.startsWith('/')) {
      const filter = val.slice(1).toLowerCase()
      setSkillFilter(filter)
      setShowSkillPicker(true)
    } else {
      setShowSkillPicker(false)
      setSkillFilter('')
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  const addFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.txt')) return
    if (file.size > 500 * 1024) return
    setPendingFiles((prev) => {
      if (prev.some((f) => f.name === file.name)) return prev
      return [...prev, file]
    })
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) addFile(file)
    e.target.value = ''
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) addFile(file)
  }

  const hasBadges =
    pendingFiles.length > 0 || selectedSkills.length > 0 || thinkingEnabled || webSearchEnabled

  return (
    <div className="relative">
      {/* Skill picker popover */}
      {showSkillPicker && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              onMouseDown={(e) => {
                e.preventDefault()
                selectSkill(skill)
              }}
              className="flex w-full items-start gap-3 border-b border-border/30 px-4 py-3 text-left last:border-0 hover:bg-muted/50 transition-colors"
            >
              <Zap className="mt-0.5 size-3.5 shrink-0 text-sidebar-primary/70" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{skill.title}</span>
                  <code className="text-[10px] text-muted-foreground">/{skill.name}</code>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {skill.description.slice(0, 100)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'w-full rounded-2xl border bg-card px-5 py-4 shadow-sm transition-all',
          'focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/20',
          isDragging ? 'border-sidebar-primary/60 bg-sidebar-primary/5' : 'border-border',
        )}
      >
        {/* Badges */}
        {hasBadges && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {thinkingEnabled && (
              <div className="flex items-center gap-1.5 rounded-md border border-muted-foreground/20 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted-foreground/10 transition-all">
                <Brain className="size-3 shrink-0" />
                <span className="font-medium">Pensamento</span>
                <button
                  onClick={onThinkingToggle}
                  aria-label="Desativar pensamento"
                  className="cursor-pointer ml-0.5 rounded transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}

            {webSearchEnabled && (
              <div className="flex items-center gap-1.5 rounded-md border border-muted-foreground/20 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted-foreground/10 transition-all">
                <Globe className="size-3 shrink-0" />
                <span className="font-medium">Pesquisa na web</span>
                <button
                  onClick={onWebSearchToggle}
                  aria-label="Desativar pesquisa na web"
                  className="cursor-pointer ml-0.5 rounded transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}

            {selectedSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center gap-1.5 rounded-md border border-muted-foreground/20 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted-foreground/10 transition-all"
              >
                <Zap className="size-3 shrink-0" />
                <span className="max-w-48 truncate font-medium">{skill.title}</span>
                <button
                  onClick={() => setSelectedSkills((prev) => prev.filter((s) => s.id !== skill.id))}
                  aria-label="Remover skill"
                  className="cursor-pointer ml-0.5 rounded transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}

            {pendingFiles.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <FileText className="size-3 shrink-0 text-sidebar-primary/70" />
                <span className="max-w-36 truncate">{f.name}</span>
                <span className="text-muted-foreground/50">· {formatBytes(f.size)}</span>
                <button
                  onClick={() => setPendingFiles((prev) => prev.filter((x) => x.name !== f.name))}
                  aria-label={`Remover ${f.name}`}
                  className="ml-0.5 rounded hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            isDragging
              ? 'Solte o arquivo .txt aqui…'
              : skills.length > 0
                ? 'Como posso ajudar? Use / para ativar uma skill…'
                : 'Como posso ajudar com SAP hoje?'
          }
          disabled={loading}
          rows={3}
          className="resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
        />

        <div className="mt-3 flex items-center justify-between">
          {/* Botão de opções */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={loading}
                title="Opções"
                aria-label="Abrir opções"
                className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-muted-foreground disabled:opacity-30 data-[state=open]:text-white"
              >
                <Plus className="size-4" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side="bottom" align="start" className="w-60">
              <DropdownMenuItem
                onSelect={() => {
                  setTimeout(() => fileInputRef.current?.click(), 0)
                }}
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                Anexar arquivo (.txt)
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuCheckboxItem
                checked={thinkingEnabled}
                onCheckedChange={onThinkingToggle}
                onSelect={(e) => e.preventDefault()}
              >
                <Brain className="size-3.5 shrink-0 text-muted-foreground" />
                Pensamento
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={webSearchEnabled}
                onCheckedChange={onWebSearchToggle}
                onSelect={(e) => e.preventDefault()}
              >
                <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                Pesquisa na web
              </DropdownMenuCheckboxItem>

              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Zap className="size-3.5 shrink-0 text-muted-foreground" />
                    Habilidades
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-64 p-0">
                      <div className="max-h-64 overflow-y-auto p-1">
                        {skills.filter((s) => s.is_active).length === 0 ? (
                          <div className="px-3 py-4 text-center">
                            <p className="text-xs text-muted-foreground">Nenhuma habilidade ativa</p>
                          </div>
                        ) : (
                          skills.filter((s) => s.is_active).map((skill) => (
                            <DropdownMenuCheckboxItem
                              key={skill.id}
                              checked={selectedSkills.some((s) => s.id === skill.id)}
                              onCheckedChange={() =>
                                setSelectedSkills((prev) =>
                                  prev.some((s) => s.id === skill.id)
                                    ? prev.filter((s) => s.id !== skill.id)
                                    : [...prev, skill],
                                )
                              }
                              onSelect={(e) => e.preventDefault()}
                              className="items-start py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium">{skill.title}</p>
                              </div>
                            </DropdownMenuCheckboxItem>
                          ))
                        )}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-muted-foreground"
                        onSelect={() => navigate('/skills')}
                      >
                        <Settings className="size-3.5 shrink-0" />
                        Gerenciar habilidades
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={handleFileInput}
          />

          <Button
            size="icon"
            onClick={() => submit()}
            disabled={!value.trim() || loading}
            className="gap-1.5"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
