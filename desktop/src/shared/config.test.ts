import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultConfig, normalizeConfig } from './config.ts'

test('fills missing nested defaults while keeping configured values', () => {
  const config = normalizeConfig({
    region: 2,
    audio_config: { audio_type: { send_danmu: true } },
    ai_analysis_settings: { request_timeout: 90, reasoning_summary: null },
  })

  assert.equal(config.region, 2)
  assert.equal(config.audio_config.audio_type.send_danmu, true)
  assert.equal(config.audio_config.audio_type.receive_problem, true)
  assert.equal(config.ai_analysis_settings.request_timeout, 90)
  assert.equal(config.ai_analysis_settings.reasoning_summary, null)
  assert.equal(config.ai_analysis_settings.max_retries, 3)
  assert.equal(config.open_at_login, false)
  assert.equal(config.auto_start_monitoring, false)
})

test('preserves startup preferences and rejects non-boolean legacy values', () => {
  const config = normalizeConfig({
    open_at_login: true,
    auto_start_monitoring: true,
  })
  assert.equal(config.open_at_login, true)
  assert.equal(config.auto_start_monitoring, true)
  const malformed = normalizeConfig({
    open_at_login: 'true',
    auto_start_monitoring: 1,
  })
  assert.equal(malformed.open_at_login, false)
  assert.equal(malformed.auto_start_monitoring, false)
})

test('ignores unknown fields and does not mutate shared defaults', () => {
  const config = normalizeConfig({
    unknown_option: true,
    danmu_config: { extra: 4 },
  })

  assert.equal('unknown_option' in config, false)
  assert.deepEqual(config.danmu_config, { danmu_limit: 5 })
  assert.deepEqual(defaultConfig.danmu_config, { danmu_limit: 5 })
})

test('recovers malformed nested values and bounds numeric settings', () => {
  const config = normalizeConfig({
    region: 3,
    audio_config: null,
    sessionid: false,
    auto_answer: 'false',
    ai_analysis_settings: {
      protocol: 'bad',
      request_timeout: -5,
      max_retries: 500,
    },
  })
  assert.equal(config.region, 3)
  assert.equal(config.sessionid, '')
  assert.equal(config.auto_answer, true)
  assert.equal(config.audio_config.audio_type.course_info, true)
  assert.equal(config.ai_analysis_settings.protocol, 'responses')
  assert.equal(config.ai_analysis_settings.max_retries, 10)
  assert.equal(config.ai_analysis_settings.request_timeout, 0.001)
  config.audio_config.audio_type.course_info = false
  assert.equal(defaultConfig.audio_config.audio_type.course_info, true)
})
