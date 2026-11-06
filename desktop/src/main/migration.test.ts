import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { copyLegacyDirectory } from './migration.ts'

test('copies legacy data once and preserves the original files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclassroom-migration-'))
  const source = join(root, 'legacy')
  const target = join(root, 'current')
  await mkdir(source)
  await writeFile(join(source, 'answers.json'), '{"answers":{}}')

  try {
    assert.equal(await copyLegacyDirectory(source, target), true)
    assert.equal(
      await readFile(join(target, 'answers.json'), 'utf8'),
      '{"answers":{}}',
    )
    assert.equal(
      await readFile(join(source, 'answers.json'), 'utf8'),
      '{"answers":{}}',
    )
    assert.equal(await copyLegacyDirectory(source, target), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not create a destination when no legacy data exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclassroom-migration-'))
  try {
    assert.equal(
      await copyLegacyDirectory(join(root, 'missing'), join(root, 'current')),
      false,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preserves the previous destination when staging cannot be committed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclassroom-migration-'))
  const source = join(root, 'legacy')
  const target = join(root, 'current')
  await mkdir(source)
  await writeFile(join(source, 'answers.json'), 'new')
  await mkdir(target)
  await writeFile(join(target, 'answers.json'), 'keep')
  try {
    assert.equal(await copyLegacyDirectory(source, target), false)
    assert.equal(await readFile(join(target, 'answers.json'), 'utf8'), 'keep')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
