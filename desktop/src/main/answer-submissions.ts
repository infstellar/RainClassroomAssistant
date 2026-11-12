import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface AnswerSubmission {
  id: string
  lessonName: string
  lessonId: string
  title: string
  slideIndex: string
  problemId: string
  sentAt: string
  status: 'sent' | 'success' | 'failed' | 'unknown'
}

export async function saveAnswerSubmission(
  root: string,
  entry: AnswerSubmission,
) {
  const directory = join(root, 'answer_submissions')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${entry.id}.json`)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(entry, null, 2), 'utf8')
  await rename(temporary, path)
}

export async function listAnswerSubmissions(
  root: string,
): Promise<AnswerSubmission[]> {
  const directory = join(root, 'answer_submissions')
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const entry = JSON.parse(
            await readFile(join(directory, name), 'utf8'),
          ) as AnswerSubmission
          return entry.id &&
            typeof entry.sentAt === 'string' &&
            Number.isFinite(Date.parse(entry.sentAt)) &&
            ['sent', 'success', 'failed', 'unknown'].includes(entry.status)
            ? entry
            : null
        } catch {
          return null
        }
      }),
  )
  return entries
    .filter((entry): entry is AnswerSubmission => entry !== null)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
}
