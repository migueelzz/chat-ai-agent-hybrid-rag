import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Square, Paperclip, X, FileText, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@/lib/types'

const LONG_TEXT_THRESHOLD = 2000

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ChatInputProps {
  onSend: (text: string, skillName?: string) => void
  onStop?: () => void
  disabled?: boolean
  isStreaming?: boolean
  pendingFiles?: File[]
  onAddFile?: (file: File) => void
  onRemoveFile?: (filename: string) => void
  skills?: SkillMeta[]
}

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  isStreaming = false,
  pendingFiles = [],
  onAddFile,
  onRemoveFile,
  skills = [],
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [showLongTextBanner, setShowLongTextBanner] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillMeta | null>(null)
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredSkills = skills.filter(
    (s) =>
      s.is_active &&
      (!skillFilter ||
        s.name.toLowerCase().includes(skillFilter) ||
        s.title.toLowerCase().includes(skillFilter)),
  )

  const selectSkill = (skill: SkillMeta) => {
    setValue('')
    setSelectedSkill(skill)
    setShowSkillPicker(false)
    setSkillFilter('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }

  const submit = (text?: string) => {
    const textToSend = (text ?? value).trim()
    if (!textToSend || disabled) return
    setValue('')
    setShowLongTextBanner(false)
    setShowSkillPicker(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const skillName = selectedSkill?.name
    setSelectedSkill(null)
    onSend(textToSend, skillName)
  }

  const convertToFile = () => {
    const text = value.trim()
    if (!text || !onAddFile) return
    const blob = new Blob([text], { type: 'text/plain' })
    const file = new File([blob], `mensagem-${Date.now()}.txt`, { type: 'text/plain' })
    onAddFile(file)
    setValue('')
    setShowLongTextBanner(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
      if (value.trim().length > LONG_TEXT_THRESHOLD) {
        setShowLongTextBanner(true)
        return
      }
      submit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    if (el.value.length <= LONG_TEXT_THRESHOLD) setShowLongTextBanner(false)
  }

  const addFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.txt')) return
    if (file.size > 500 * 1024) return
    onAddFile?.(file)
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

  const hasBadges = pendingFiles.length > 0 || !!selectedSkill

  return (
    <div className="bg-background px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-2">
        {/* Banner: texto longo */}
        {showLongTextBanner && (
          <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
            <span>Mensagem longa detectada. Deseja converter em arquivo .txt?</span>
            <div className="flex items-center gap-2 ml-3">
              <button onClick={convertToFile} className="font-medium hover:underline">
                Converter
              </button>
              <button
                onClick={() => {
                  setShowLongTextBanner(false)
                  submit()
                }}
                className="text-muted-foreground hover:underline"
              >
                Enviar assim mesmo
              </button>
            </div>
          </div>
        )}

        {/* Badges: skill selecionada + arquivos pendentes */}
        {hasBadges && (
          <div className="flex flex-wrap gap-1.5">
            {selectedSkill && (
              <div className="flex items-center gap-1.5 rounded-md border border-sidebar-primary/30 bg-sidebar-primary/10 px-2.5 py-1 text-xs text-sidebar-primary">
                <Zap className="size-3 shrink-0" />
                <span className="max-w-48 truncate font-medium">{selectedSkill.title}</span>
                <button
                  onClick={() => setSelectedSkill(null)}
                  className="ml-0.5 rounded transition-colors hover:text-sidebar-primary/60"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            {pendingFiles.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <FileText className="size-3 shrink-0 text-sidebar-primary/70" />
                <span className="max-w-36 truncate">{f.name}</span>
                <span className="text-muted-foreground/50">· {formatBytes(f.size)}</span>
                <button
                  onClick={() => onRemoveFile?.(f.name)}
                  className="ml-0.5 rounded hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input principal com skill picker posicionado acima */}
        <div className="relative">
          {/* Skill picker popover */}
          {showSkillPicker && filteredSkills.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
              {filteredSkills.map((skill) => (
                <button
                  key={skill.id}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before click registers
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
              'flex items-end gap-2 rounded-2xl border bg-card px-4 py-3 transition-all',
              'focus-within:border-ring/50 focus-within:ring-1 focus-within:ring-ring/20',
              isDragging
                ? 'border-sidebar-primary/60 bg-sidebar-primary/5'
                : 'border-border',
            )}
          >
            {/* Botão de arquivo */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled && !isStreaming}
              title="Anexar arquivo .txt"
              className="mb-0.5 shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleFileInput}
            />

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
                    ? 'Faça uma pergunta ou use /skill para ativar uma skill…'
                    : 'Faça uma pergunta sobre SAP…'
              }
              disabled={disabled && !isStreaming}
              rows={1}
              className={cn(
                'flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50',
                'min-h-6 max-h-50',
              )}
            />

            {isStreaming ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onStop}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Parar"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                onClick={() => submit()}
                disabled={!value.trim() || disabled}
                title="Enviar (Enter)"
                className="shrink-0"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40">
          Enter para enviar · Shift+Enter para nova linha · Digite / para skills
        </p>
      </div>
    </div>
  )
}
