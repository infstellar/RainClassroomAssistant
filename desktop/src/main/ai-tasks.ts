import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiTask } from '../shared/contract'

export const aiSession = randomUUID()

export async function saveAiTask(root: string, task: AiTask) {
  const directory = join(root, 'ai_tasks')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${task.id}.json`)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(task, null, 2), 'utf8')
  await rename(temporary, path)
}

export async function listAiTasks(root: string): Promise<AiTask[]> {
  const directory = join(root, 'ai_tasks')
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  const tasks = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const task = JSON.parse(
            await readFile(join(directory, name), 'utf8'),
          ) as AiTask
          if (!task.id || !Array.isArray(task.attempts)) return null
          if (
            task.session !== aiSession &&
            ['running', 'retrying'].includes(task.status)
          )
            return {
              ...task,
              status: 'interrupted' as const,
              error: '上次运行已结束，任务未完成',
            }
          return task
        } catch {
          return null
        }
      }),
  )
  return tasks
    .filter((task): task is AiTask => task !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
