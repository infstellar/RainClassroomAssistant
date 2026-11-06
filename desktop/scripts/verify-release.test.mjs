import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dump } from 'js-yaml'
import { verifyRelease } from './verify-release.mjs'

test('release verification accepts complete assets and rejects corrupt/missing ones', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rain-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const name = 'RainClassroomAssistant-Setup-0.5.0.exe'
  const content = Buffer.from('fixture-installer')
  const sha512 = createHash('sha512').update(content).digest('base64')
  const metadata = {
    version: '0.5.0',
    path: name,
    sha512,
    files: [{ url: name, sha512, size: content.length }],
  }
  await writeFile(join(directory, name), content)
  await writeFile(join(directory, `${name}.blockmap`), 'fixture-blockmap')
  await writeFile(
    join(directory, 'RainClassroomAssistant.exe'),
    'fixture-portable',
  )
  await writeFile(join(directory, 'latest.yml'), dump(metadata))
  assert.equal((await verifyRelease(directory, '0.5.0')).length, 6)
  assert.equal(await readFile(join(directory, 'version.txt'), 'utf8'), '0.5.0')
  assert.match(
    await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8'),
    /latest.yml/,
  )
  await assert.rejects(verifyRelease(directory, '0.6.0'), /version mismatch/)
  await writeFile(join(directory, name), 'tampered installer')
  await assert.rejects(verifyRelease(directory, '0.5.0'), /SHA-512 mismatch/)
  await writeFile(join(directory, name), content)
  await rm(join(directory, `${name}.blockmap`))
  await assert.rejects(verifyRelease(directory, '0.5.0'), /ENOENT/)
})

test('publishing uploads to a draft and only makes it public after successful upload', async () => {
  const { publishRelease } = await import('./publish-release.mjs')
  for (const scenario of ['new', 'draft', 'published', 'failed-upload']) {
    const commands = []
    const gh = (...args) => {
      commands.push(args)
      if (args[0] === 'api')
        return JSON.stringify([
          [
            ...(scenario === 'draft' || scenario === 'published'
              ? [{ tag_name: 'v0.5.0', draft: scenario === 'draft' }]
              : []),
          ],
        ])
      if (args[1] === 'upload' && scenario === 'failed-upload')
        throw new Error('upload failed')
      return ''
    }
    const publish = () =>
      publishRelease({
        tag: 'v0.5.0',
        directory: '/release',
        assets: ['latest.yml', 'installer.exe'],
        repository: 'owner/repo',
        gh,
      })
    if (scenario === 'published' || scenario === 'failed-upload') {
      assert.throws(publish)
      assert.equal(
        commands.some((args) => args[1] === 'edit'),
        false,
      )
      if (scenario === 'published') assert.equal(commands.length, 1)
    } else {
      publish()
      assert.deepEqual(
        commands.map((args) => args[1]),
        scenario === 'new'
          ? ['repos/owner/repo/releases', 'create', 'upload', 'edit']
          : ['repos/owner/repo/releases', 'upload', 'edit'],
      )
      if (scenario === 'new') assert.ok(commands[1].includes('--draft'))
    }
  }
})
