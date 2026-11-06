import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultConfig } from '../shared/config.ts'
import { isEmailConfigReady, sendEmail } from './notifier.ts'
import type { EmailConfig } from '../shared/contract.ts'

const email: EmailConfig = {
  ...defaultConfig.email_config,
  enabled: true,
  smtp_server: ' smtp.example.com ',
  username: 'sender@example.com',
  password: 'private-token',
  recipient: 'receiver@example.com',
}
const logger = { write: async () => undefined } as never

test('requires an enabled account with all required SMTP fields', () => {
  assert.equal(isEmailConfigReady(email), true)
  assert.equal(isEmailConfigReady({ ...email, enabled: false }), false)
  assert.equal(isEmailConfigReady({ ...email, password: '' }), false)
})

test('sends the configured message over implicit TLS without exposing credentials', async () => {
  let options: unknown
  let sent: unknown
  const result = await sendEmail(email, '课堂答题成功', logger, (value) => {
    options = value
    return {
      sendMail: async (message) => {
        sent = message
      },
    }
  })
  assert.equal(result, true)
  assert.deepEqual(options, {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    requireTLS: false,
    connectionTimeout: 10000,
    auth: { user: 'sender@example.com', pass: 'private-token' },
  })
  assert.deepEqual(sent, {
    from: 'sender@example.com',
    to: 'receiver@example.com',
    subject: '雨课堂助手通知',
    text: '课堂答题成功',
  })
})

test('uses STARTTLS when implicit TLS is disabled and sanitizes transport failures', async () => {
  let requireTLS = false
  const result = await sendEmail(
    { ...email, use_ssl: false, starttls: true },
    'test',
    logger,
    (options) => {
      requireTLS = options.requireTLS
      return {
        sendMail: async () => {
          throw new Error('authentication failed: private-token')
        },
      }
    },
  )
  assert.equal(requireTLS, true)
  assert.equal(result, false)
})
