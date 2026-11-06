import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import {
  downloadPresentation,
  safePathComponent,
  slideImagePath,
} from './presentation.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
  'base64',
)

test('downloads slide assets and produces a readable PDF in the legacy folder layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-desktop-'))
  try {
    const result = await downloadPresentation({
      slides: [{ index: 1, cover: 'https://assets.example/slide.png' }],
      title: '第一章',
      lessonName: '课程/A',
      dimensions: { width: 800, height: 600 },
      root,
      fetcher: async () =>
        new Response(png, { headers: { 'content-type': 'image/png' } }),
      logger: { write: async () => undefined } as never,
    })
    const document = await PDFDocument.load(await readFile(result.pdfPath))
    assert.equal(document.getPageCount(), 1)
    assert.equal(result.slideCount, 1)
    assert.equal(result.pdfPath.includes(join('downloads', '课程_A')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizes invalid and reserved Windows path components', () => {
  assert.equal(safePathComponent('CON'), '_CON')
  assert.equal(safePathComponent('a/b:c'), 'a_b_c')
})

test('keeps untrusted slide indexes within the presentation directory', () => {
  const directory = join(tmpdir(), 'slides')
  assert.equal(slideImagePath(directory, 3), join(directory, '3.jpg'))
  assert.equal(
    slideImagePath(directory, '../escape'),
    join(directory, '.._escape.jpg'),
  )
})

test('force refresh replaces cached slide assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-desktop-refresh-'))
  let downloads = 0
  try {
    const options = {
      slides: [{ index: 1, cover: 'https://assets.example/slide.png' }],
      title: '更新课件',
      lessonName: '课程',
      dimensions: { width: 800, height: 600 },
      root,
      fetcher: async () => {
        downloads += 1
        return new Response(png)
      },
      logger: { write: async () => undefined } as never,
    }
    await downloadPresentation(options)
    await downloadPresentation({ ...options, forceRefresh: true })
    assert.equal(downloads, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
