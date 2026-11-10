import { readdir, realpath, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { DownloadedPresentation } from '../shared/contract.ts'
import { loginImageMime } from './login-image.ts'

const imageName = /\.(jpe?g|png|webp|gif)$/i
const compareNames = (a: string, b: string) =>
  a.localeCompare(b, 'zh-CN', { numeric: true })

// Resolve every component to keep junctions and symbolic links inside the cache.
export async function resolvePptPath(root: string, parts: string[]) {
  if (
    parts.some(
      (part) =>
        typeof part !== 'string' ||
        !part ||
        part === '.' ||
        part === '..' ||
        /[\\/:\0]/.test(part),
    )
  )
    throw new Error('课件路径无效')
  const base = await realpath(join(root, 'downloads', 'rainclasscache'))
  const target = await realpath(join(base, ...parts))
  const child = relative(base, target)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('课件路径超出下载目录')
  return target
}

export async function listDownloadedPresentations(
  root: string,
): Promise<DownloadedPresentation[]> {
  const base = join(root, 'downloads', 'rainclasscache')
  let courses
  try {
    courses = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const result: DownloadedPresentation[] = []
  for (const course of courses.filter((entry) => entry.isDirectory())) {
    const coursePath = await resolvePptPath(root, [course.name])
    for (const deck of await readdir(coursePath, { withFileTypes: true })) {
      if (!deck.isDirectory()) continue
      const directory = await resolvePptPath(root, [course.name, deck.name])
      const slides = []
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !imageName.test(entry.name)) continue
        const info = await stat(join(directory, entry.name))
        if (info.size === 0) continue
        slides.push({ name: entry.name, modified: info.mtimeMs })
      }
      if (!slides.length) continue
      slides.sort((a, b) => compareNames(a.name, b.name))
      result.push({
        course: course.name,
        title: deck.name,
        slides,
        modified: Math.max(...slides.map((slide) => slide.modified)),
      })
    }
  }
  return result.sort(
    (a, b) => b.modified - a.modified || compareNames(a.title, b.title),
  )
}

export async function readPptImage(
  root: string,
  course: string,
  title: string,
  name: string,
) {
  if (!imageName.test(name)) throw new Error('不支持的图片类型')
  const path = await resolvePptPath(root, [course, title, name])
  const info = await stat(path)
  if (!info.isFile() || info.size > 30 * 1024 * 1024)
    throw new Error('图片数据大小无效')
  const bytes = await readFile(path)
  const mime = loginImageMime(bytes)
  if (!mime) throw new Error('图片已损坏或格式不支持')
  return `data:${mime};base64,${bytes.toString('base64')}`
}
