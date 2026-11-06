import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './verify-release.mjs'

export function publishRelease({ tag, directory, assets, repository, gh }) {
  // Never overwrite an already published version, including on workflow reruns.
  const existing = JSON.parse(
    gh('api', `repos/${repository}/releases`, '--paginate', '--slurp'),
  )
    .flat()
    .find((release) => release.tag_name === tag)
  if (existing && !existing.draft)
    throw new Error('This release is already published')
  if (!existing)
    gh(
      'release',
      'create',
      tag,
      '--verify-tag',
      '--draft',
      '--title',
      tag,
      '--generate-notes',
    )
  gh(
    'release',
    'upload',
    tag,
    ...assets.map((name) => join(directory, name)),
    '--clobber',
  )
  gh('release', 'edit', tag, '--draft=false', '--latest')
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const tag = process.env.RELEASE_TAG
  if (tag !== `v${version}`) throw new Error('Release tag/version mismatch')
  const directory = resolve('release')
  const assets = await verifyRelease(directory, version)
  const gh = (...args) =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  publishRelease({
    tag,
    directory,
    assets,
    repository: process.env.GITHUB_REPOSITORY,
    gh,
  })
}
