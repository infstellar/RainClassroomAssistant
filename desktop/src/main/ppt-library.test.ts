import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDownloadedPresentations, readPptImage } from './ppt-library.ts'

test('lists downloaded pages in numeric order and detects MIME from content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ppt-library-'))
  try {
    assert.deepEqual(await listDownloadedPresentations(root), [])
    const directory = join(root, 'downloads', 'rainclasscache', '课程', 'PPT')
    await mkdir(directory, { recursive: true })
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    )
    for (const name of ['10.jpg', '2.jpg', '1.jpg'])
      await writeFile(join(directory, name), png)
    await writeFile(join(directory, 'empty.jpg'), '')
    await writeFile(join(directory, 'notes.txt'), 'not an image')
    await writeFile(join(directory, 'broken.png'), 'invalid')
    const decks = await listDownloadedPresentations(root)
    assert.equal(decks.length, 1)
    assert.deepEqual(
      decks[0].slides.map((slide) => slide.name),
      ['1.jpg', '2.jpg', '10.jpg', 'broken.png'],
    )
    assert.match(
      await readPptImage(root, '课程', 'PPT', '1.jpg'),
      /^data:image\/png;base64,/,
    )
    await assert.rejects(
      readPptImage(root, '课程', 'PPT', 'broken.png'),
      /损坏/,
    )
    await assert.rejects(readPptImage(root, '课程', 'PPT', 'notes.txt'), /类型/)
    for (const course of ['..', '../课程', 'C:\\Windows', '课程/..'])
      await assert.rejects(readPptImage(root, course, 'PPT', '1.jpg'), /路径/)
    await assert.rejects(readPptImage(root, '课程', 'PPT', '../1.jpg'), /路径/)
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.jpg'), png)
    await symlink(
      outside,
      join(directory, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await assert.rejects(
      readPptImage(root, '课程', 'PPT', 'escape/secret.jpg'),
      /路径/,
    )
    // Even a deck directory junction must not escape the cache.
    await symlink(
      outside,
      join(root, 'downloads', 'rainclasscache', '课程', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await assert.rejects(
      readPptImage(root, '课程', 'linked', 'secret.jpg'),
      /超出/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
