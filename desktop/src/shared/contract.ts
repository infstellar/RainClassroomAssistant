export type LogLevel = 'INFO' | 'WARNING' | 'ERROR'

export interface LogEntry {
  id: string
  time: string
  level: LogLevel
  source: string
  message: string
}

export interface RuntimeState {
  connected: boolean
  listening: boolean
  courses: number
  lastUpdated: string | null
  userName: string | null
  error: string | null
}

export interface UpdateState {
  status:
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'not-available'
    | 'error'
  version?: string
  percent?: number
  message?: string
}

export interface Course {
  lessonId: string
  courseName: string
  classroomId: string
  title?: string | null
  teacher?: string | null
  startTime?: string | null
  status?: 'joining' | 'connected' | 'waiting'
}

export interface EmailConfig {
  enabled: boolean
  smtp_server: string
  smtp_port: number
  username: string
  password: string
  sender: string
  recipient: string
  subject: string
  use_ssl: boolean
  starttls: boolean
  timeout: number
}

export interface AnswerDelayConfig {
  type: number
  custom: { percent: number }
}

export interface SignDelayConfig {
  type: number
  custom: { time: number; cutoff: number }
}

export interface AiAnalysisSettings {
  protocol: 'responses' | 'chat_completions'
  stream: boolean
  reasoning_effort: string
  reasoning_summary: string | null
  max_output_tokens: number | null
  max_retries: number
  request_timeout: number
  delay_between_requests: number
}

export interface AssistantConfig {
  sessionid: string
  region: string | number
  auto_danmu: boolean
  danmu_config: { danmu_limit: number }
  audio_on: boolean
  audio_config: {
    audio_type: {
      send_danmu: boolean
      others_danmu: boolean
      receive_problem: boolean
      answer_result: boolean
      im_called: boolean
      others_called: boolean
      course_info: boolean
      network_info: boolean
    }
  }
  auto_answer: boolean
  answer_config: { answer_delay: AnswerDelayConfig }
  email_config: EmailConfig
  sign_config: { delay_time: SignDelayConfig }
  enable_ai_analysis: boolean
  openai_api_key: string
  openai_api_base: string
  openai_model: string
  ai_analysis_settings: AiAnalysisSettings
}

export interface DesktopBridge {
  getRuntimeState(): Promise<RuntimeState>
  getCourses(): Promise<Course[]>
  getLogs(): Promise<LogEntry[]>
  getConfig(): Promise<AssistantConfig>
  saveConfig(config: AssistantConfig): Promise<AssistantConfig>
  testEmail(config: AssistantConfig): Promise<boolean>
  openLogFolder(): Promise<void>
  startMonitoring(): Promise<RuntimeState>
  stopMonitoring(): Promise<RuntimeState>
  onRuntimeState(callback: (state: RuntimeState) => void): () => void
  onLog(callback: (entry: LogEntry) => void): () => void
  beginLogin(region: number): Promise<void>
  cancelLogin(): Promise<void>
  onLoginUpdate(callback: (update: LoginUpdate) => void): () => void
  onSpeak(callback: (message: string) => void): () => void
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  openReleasePage(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateState(callback: (state: UpdateState) => void): () => void
}

export interface LoginUpdate {
  status: 'connecting' | 'qr' | 'success' | 'error' | 'closed'
  image?: string
  message?: string
}
