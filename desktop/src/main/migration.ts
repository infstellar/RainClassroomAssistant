import { access, cp, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export async function copyLegacyDirectory(source: string, target: string) {
  try {
    await access(target)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    await access(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  const staging = `${target}.migration-${randomUUID()}`
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return true
}
