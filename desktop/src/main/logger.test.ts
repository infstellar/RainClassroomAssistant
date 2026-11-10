import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppLogger, redactSecrets } from './logger.ts'

test('redacts JSON, cookie and bearer secrets without losing surrounding diagnostics', () => {
  const result = redactSecrets(
    'sessionid=secret; {"openai_api_key":"private","password":"hidden"} Authorization: Bearer token-value',
  )
  assert.doesNotMatch(result, /secret|private|hidden|token-value/)
  assert.match(result, /REDACTED/)
})

test('serializes concurrent multiline logs and reloads records across size rotations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainclass-logs-'))
  try {
    const logger = new AppLogger(directory, () => undefined, 600)
    await logger.load()
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        logger.write('INFO', 'test', `event ${i}\nsecond line`),
      ),
    )
    assert.equal(logger.list().length, 8)
    const files = await readdir(directory)
    assert.ok(files.length > 1)
    for (const name of files) {
      const lines = (await readFile(join(directory, name), 'utf8'))
        .trim()
        .split('\n')
      for (const line of lines)
        assert.match(JSON.parse(line).message, /second line/)
    }
    const restored = new AppLogger(directory, () => undefined)
    await restored.load()
    assert.ok(restored.list().length >= 4)
    assert.match(restored.list().at(-1)!.message, /event 7/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('persists and reloads DEBUG level with redacted diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainclass-debug-'))
  try {
    const logger = new AppLogger(directory, () => undefined)
    await logger.write(
      'DEBUG',
      '自动答题',
      'payload result=["C"] authorization=secret',
    )
    const restored = new AppLogger(directory, () => undefined)
    await restored.load()
    assert.equal(restored.list()[0].level, 'DEBUG')
    assert.match(restored.list()[0].message, /result=\["C"\]/)
    assert.doesNotMatch(restored.list()[0].message, /secret/)
    const disk = await readFile(
      join(directory, 'RainClassroomAssistant.jsonl'),
      'utf8',
    )
    assert.doesNotMatch(disk, /secret/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
