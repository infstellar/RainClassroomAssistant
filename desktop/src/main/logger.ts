import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '../shared/contract'

export function redactSecrets(message: string) {
  return message
    .replace(
      /((?:sessionid|(?:openai_)?api[_ -]?key|password|authorization)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,;"'}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
}

export class AppLogger {
  private entries: LogEntry[] = []
  private sequence = 0
  private pending = Promise.resolve()
  private size = 0
  private readonly path: string

  constructor(
    private readonly directory: string,
    private readonly onEntry: (entry: LogEntry) => void,
    private readonly maxBytes = 10 * 1024 * 1024,
  ) {
    this.path = join(directory, 'RainClassroomAssistant.jsonl')
  }

  async load() {
    try {
      await mkdir(this.directory, { recursive: true })
      const files = await readdir(this.directory)
      const logs = await Promise.all(
        files
          .filter((name) =>
            /^RainClassroomAssistant(?:\.\d+)?\.(?:log|jsonl)$/.test(name),
          )
          .map(async (name) => ({
            name,
            info: await stat(join(this.directory, name)),
          })),
      )
      logs.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)
      for (const { name } of logs.slice(-4)) {
        const content = await readFile(
          join(this.directory, name),
          'utf8',
        ).catch(() => '')
        for (const line of content.trim().split(/\r?\n/).slice(-500)) {
          if (!line) continue
          try {
            const entry = JSON.parse(line) as LogEntry
            if (
              typeof entry.time !== 'string' ||
              typeof entry.source !== 'string' ||
              typeof entry.message !== 'string'
            )
              continue
            this.entries.push({
              ...entry,
              id: `disk-${++this.sequence}`,
              source: redactSecrets(entry.source),
              message: redactSecrets(entry.message),
              level: normalizeLevel(entry.level),
            })
          } catch {
            const match = line.match(/^(\S+ \S+) \| (\w+) +\| ([^|]+) \| (.*)$/)
            if (match)
              this.entries.push({
                id: `disk-${++this.sequence}`,
                time: match[1],
                level: normalizeLevel(match[2]),
                source: match[3].trim(),
                message: redactSecrets(match[4]),
              })
          }
        }
      }
      this.entries = this.entries.slice(-500)
      this.size = (await stat(this.path).catch(() => null))?.size ?? 0
    } catch {
      /* Disk logging must not prevent startup. */
    }
  }

  list() {
    return [...this.entries]
  }

  write(level: LogLevel, source: string, message: string) {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${++this.sequence}`,
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      level,
      source: redactSecrets(source),
      message: redactSecrets(message),
    }
    this.entries = [...this.entries.slice(-499), entry]
    try {
      this.onEntry(entry)
    } catch {
      /* A closed renderer cannot interrupt persistence. */
    }
    const line = `${JSON.stringify(entry)}\n`
    const bytes = Buffer.byteLength(line)
    this.pending = this.pending
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        if (this.size > 0 && this.size + bytes > this.maxBytes) {
          await rename(
            this.path,
            join(
              this.directory,
              `RainClassroomAssistant.${Date.now()}${++this.sequence}.jsonl`,
            ),
          )
          this.size = 0
        }
        await appendFile(this.path, line, 'utf8')
        this.size += bytes
      })
      .catch(() => undefined)
    return this.pending
  }
}

function normalizeLevel(level: string): LogLevel {
  return level === 'ERROR' ? 'ERROR' : level === 'WARNING' ? 'WARNING' : 'INFO'
}
