import type { AssistantConfig } from './contract'

export const defaultConfig: AssistantConfig = {
  sessionid: '',
  region: '1',
  auto_danmu: false,
  danmu_config: { danmu_limit: 5 },
  audio_on: true,
  audio_config: {
    audio_type: {
      send_danmu: false,
      others_danmu: false,
      receive_problem: true,
      answer_result: true,
      im_called: true,
      others_called: true,
      course_info: true,
      network_info: true,
    },
  },
  auto_answer: true,
  answer_config: { answer_delay: { type: 1, custom: { percent: 50 } } },
  email_config: {
    enabled: false,
    smtp_server: '',
    smtp_port: 465,
    username: '',
    password: '',
    sender: '',
    recipient: '',
    subject: '雨课堂助手通知',
    use_ssl: true,
    starttls: true,
    timeout: 10,
  },
  sign_config: { delay_time: { type: 1, custom: { time: 120, cutoff: 120 } } },
  enable_ai_analysis: false,
  openai_api_key: '',
  openai_api_base: 'https://api.openai.com/v1',
  openai_model: 'gpt-4-vision-preview',
  ai_analysis_settings: {
    protocol: 'responses',
    stream: true,
    reasoning_effort: 'high',
    reasoning_summary: 'auto',
    max_output_tokens: null,
    max_retries: 3,
    request_timeout: 30,
    delay_between_requests: 1,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeKnown(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
) {
  const merged: Record<string, unknown> = structuredClone(base)
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) continue
    const defaultValue = base[key]
    if (isRecord(defaultValue)) {
      if (isRecord(value)) merged[key] = mergeKnown(defaultValue, value)
      continue
    }
    if (
      value === null &&
      (defaultValue === null || key === 'reasoning_summary')
    ) {
      merged[key] = null
      continue
    }
    if (defaultValue === null) {
      if (typeof value === 'number' && Number.isFinite(value))
        merged[key] = value
      continue
    }
    if (
      typeof value === typeof defaultValue &&
      (typeof value !== 'number' || Number.isFinite(value))
    )
      merged[key] = value
  }
  return merged
}

export function normalizeConfig(value: unknown): AssistantConfig {
  if (!isRecord(value)) return structuredClone(defaultConfig)
  const config = mergeKnown(
    defaultConfig as unknown as Record<string, unknown>,
    value,
  ) as unknown as AssistantConfig
  const region = Number(value.region)
  config.region =
    (typeof value.region === 'number' || typeof value.region === 'string') &&
    Number.isInteger(region) &&
    region >= 0 &&
    region <= 3
      ? typeof value.region === 'number'
        ? region
        : String(region)
      : defaultConfig.region
  const clamp = (number: number, min: number, max: number) =>
    Math.max(min, Math.min(max, number))
  config.danmu_config.danmu_limit = Math.round(
    clamp(config.danmu_config.danmu_limit, 1, 10000),
  )
  config.answer_config.answer_delay.type = Math.round(
    clamp(config.answer_config.answer_delay.type, 1, 4),
  )
  config.answer_config.answer_delay.custom.percent = clamp(
    config.answer_config.answer_delay.custom.percent,
    0,
    100,
  )
  config.sign_config.delay_time.type = Math.round(
    clamp(config.sign_config.delay_time.type, 1, 2),
  )
  config.sign_config.delay_time.custom.time = clamp(
    config.sign_config.delay_time.custom.time,
    0,
    86400,
  )
  config.sign_config.delay_time.custom.cutoff = clamp(
    config.sign_config.delay_time.custom.cutoff,
    0,
    86400,
  )
  config.email_config.smtp_port = Math.round(
    clamp(config.email_config.smtp_port, 1, 65535),
  )
  config.email_config.timeout = clamp(config.email_config.timeout, 1, 600)
  const ai = config.ai_analysis_settings
  if (!['responses', 'chat_completions'].includes(ai.protocol))
    ai.protocol = 'responses'
  ai.max_retries = Math.round(clamp(ai.max_retries, 0, 10))
  ai.request_timeout = clamp(ai.request_timeout, 0.001, 3600)
  ai.delay_between_requests = clamp(ai.delay_between_requests, 0, 3600)
  if (ai.max_output_tokens !== null)
    ai.max_output_tokens = Math.round(clamp(ai.max_output_tokens, 1, 1000000))
  return config
}
