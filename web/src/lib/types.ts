export interface MessageChunk {
  type: 'token' | 'tool_start' | 'tool_end' | 'thinking' | 'error' | 'done'
  content: string
  tool_name?: string | null
  is_document?: boolean
  next_skill?: string | null
}

export interface ToolCall {
  id: string
  name: string
  status: 'running' | 'done'
  output?: string
  toolInput?: Record<string, string>
  sourceDocs?: Array<{ filename: string }>
}

export interface Source {
  type: 'doc' | 'web' | 'file'
  label: string
  filename?: string
  sizeBytes?: number
  url?: string
}

export interface AttachmentMeta {
  id: number
  filename: string
  size_bytes: number
  source_zip?: string
  zip_path?: string
}

export interface ZipUploadResponse {
  success: boolean
  zip_filename: string
  files_extracted: number
  total_size_bytes: number
  files: Array<{
    filename: string
    zip_path: string
    size_bytes: number
  }>
}

export interface ChatMessage {
  id: string
  role: 'human' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  thinkingContent?: string
  isStreaming?: boolean
  hasError?: boolean
  elapsedMs?: number
  attachments?: AttachmentMeta[]
  isDocument?: boolean
  nextSkill?: string | null
}

export interface Session {
  id: string
  title: string
  createdAt: string
}

export interface CreateSessionResponse {
  session_id: string
  created_at: string
}

export interface HistoryMessage {
  role: 'human' | 'assistant' | 'tool'
  content: string
  tool_name?: string | null
}

export interface HistoryResponse {
  session_id: string
  messages: HistoryMessage[]
}

export interface SkillMeta {
  id: number
  name: string
  title: string
  description: string
  is_active: boolean
  created_at: string
}

export interface DailyCalls {
  date: string
  calls: number
}

export interface MetricsSummary {
  total_calls: number
  avg_latency_ms: number
  error_count: number
  total_spend: number | null
  total_tokens: number | null
}

export interface ProviderBudget {
  provider: string
  budget_limit: number | null
  spend: number
  time_period: string | null
  budget_reset_at: string | null
}

export interface ErrorLog {
  id: number
  session_id: string | null
  timestamp: string
  error_message: string | null
  error_type: string | null
  tool_name: string | null
}
