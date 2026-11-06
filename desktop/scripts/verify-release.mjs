import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

export async function verifyRelease(directory, version) {
  const metadata = load(await readFile(join(directory, 'latest.yml'), 'utf8'))
  assert.equal(metadata.version, version, 'latest.yml version mismatch')
  const installer = `RainClassroomAssistant-Setup-${version}.exe`
  assert.equal(metadata.path, installer, 'Unexpected update installer')
  assert.equal(metadata.files.length, 1, 'Expected one Windows x64 installer')
  const file = metadata.files[0]
  assert.equal(file.url, installer, 'Unexpected update URL')
  const bytes = await readFile(join(directory, installer))
  assert.ok(bytes.length > 0, 'Empty installer')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  assert.equal(metadata.sha512, sha512, 'Legacy SHA-512 mismatch')
  assert.equal(file.sha512, sha512, 'Installer SHA-512 mismatch')
  assert.equal(file.size, bytes.length, 'Installer size mismatch')
  const assets = [
    installer,
    `${installer}.blockmap`,
    'RainClassroomAssistant.exe',
    'latest.yml',
  ]
  const sums = []
  for (const name of assets) {
    const content = await readFile(join(directory, name))
    assert.ok(content.length > 0, `Empty release asset: ${name}`)
    sums.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`)
  }
  await writeFile(join(directory, 'version.txt'), version, 'ascii')
  sums.push(
    `${createHash('sha256').update(version).digest('hex')}  version.txt`,
  )
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  return [...assets, 'version.txt', 'SHA256SUMS.txt']
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  console.log(await verifyRelease(resolve('release'), version))
}
