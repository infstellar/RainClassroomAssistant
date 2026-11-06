import nodemailer from 'nodemailer'
import type { AssistantConfig, EmailConfig } from '../shared/contract'
import type { AppLogger } from './logger'

export interface MailTransport {
  sendMail(message: {
    from: string
    to: string
    subject: string
    text: string
  }): Promise<unknown>
}

export type MailTransportFactory = (options: {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  connectionTimeout: number
  auth: { user: string; pass: string }
}) => MailTransport

const createTransport: MailTransportFactory = (options) =>
  nodemailer.createTransport(options)

export function isEmailConfigReady(email: EmailConfig) {
  return Boolean(
    email.enabled &&
    email.smtp_server.trim() &&
    email.username.trim() &&
    email.password &&
    email.recipient.trim(),
  )
}

export async function sendEmail(
  email: EmailConfig,
  message: string,
  logger: AppLogger,
  transportFactory: MailTransportFactory = createTransport,
) {
  if (!isEmailConfigReady(email)) return false
  try {
    const secure = email.use_ssl ?? true
    const transport = transportFactory({
      host: email.smtp_server.trim(),
      port: Number(email.smtp_port) || 465,
      secure,
      requireTLS: !secure && (email.starttls ?? true),
      connectionTimeout: (Number(email.timeout) || 10) * 1000,
      auth: { user: email.username, pass: email.password },
    })
    await transport.sendMail({
      from: email.sender.trim() || email.username,
      to: email.recipient.trim(),
      subject: email.subject.trim() || '雨课堂助手通知',
      text: message,
    })
    await logger.write('INFO', '邮件通知', '邮件已发送')
    return true
  } catch {
    await logger.write(
      'WARNING',
      '邮件通知',
      '发送失败，请检查 SMTP 配置和服务商授权码',
    )
    return false
  }
}

export function sendEmailNotificationIfNeeded(
  message: string,
  config: AssistantConfig,
  logger: AppLogger,
) {
  if (!isEmailConfigReady(config.email_config)) return false
  void sendEmail(config.email_config, message, logger)
  return true
}

export function sendTestEmail(config: AssistantConfig, logger: AppLogger) {
  return sendEmail(
    config.email_config,
    '这是一封雨课堂助手测试邮件。收到此邮件表示邮件通知配置可用。',
    logger,
  )
}
