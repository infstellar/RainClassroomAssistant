import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { UpdateController } from './updater.ts'

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = true
  allowDowngrade = true
  calls = 0
  installs = 0
  failure = false
  async checkForUpdates() {
    this.calls++
    if (this.failure) throw new Error('Network unavailable')
    this.emit('update-not-available', { version: '0.5.0' })
    return null
  }
  quitAndInstall() {
    this.installs++
  }
}

function setup(enabled = true) {
  const updater = new FakeUpdater()
  const controller = new UpdateController(
    updater,
    enabled,
    () => {},
    () => {},
  )
  return { updater, controller }
}

test('development/portable mode never requests or installs an update', async () => {
  const { updater, controller } = setup(false)
  controller.start()
  await controller.check()
  assert.equal(updater.calls, 0)
  assert.match(controller.state.message!, /手动下载/)
  assert.throws(() => controller.install(), /尚未下载/)
  controller.stop()
})

test('checks are coalesced and stable updates download automatically', async () => {
  const { updater, controller } = setup()
  await Promise.all([controller.check(), controller.check()])
  assert.equal(updater.calls, 1)
  assert.equal(controller.state.version, '0.5.0')
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(updater.allowPrerelease, false)
  assert.equal(updater.allowDowngrade, false)
})

test('checking cannot erase download progress or a ready installer', async () => {
  const { updater, controller } = setup()
  assert.throws(() => controller.install())
  updater.emit('update-available', { version: '0.6.0' })
  await controller.check()
  assert.equal(controller.state.status, 'available')
  updater.emit('download-progress', { percent: 42.4 })
  await controller.check()
  assert.equal(controller.state.percent, 42)
  updater.emit('update-downloaded', { version: '0.6.0' })
  await controller.check()
  assert.equal(controller.state.status, 'downloaded')
  assert.equal(updater.calls, 0)
  controller.install()
  assert.equal(updater.installs, 1)
})

test('network/download errors can be retried', async () => {
  const { updater, controller } = setup()
  updater.failure = true
  await controller.check()
  assert.equal(controller.state.status, 'error')
  updater.failure = false
  await controller.check()
  assert.equal(controller.state.status, 'not-available')
  updater.emit('error', new Error('Checksum mismatch'))
  assert.equal(controller.state.status, 'error')
  await controller.check()
  assert.equal(updater.calls, 3)
})

test('startup check and periodic checks stop when the app quits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { updater, controller } = setup()
  controller.start()
  t.mock.timers.tick(4999)
  assert.equal(updater.calls, 0)
  t.mock.timers.tick(1)
  await controller.check()
  assert.equal(updater.calls, 1)
  t.mock.timers.tick(4 * 60 * 60 * 1000)
  await controller.check()
  assert.equal(updater.calls, 2)
  controller.stop()
  t.mock.timers.tick(4 * 60 * 60 * 1000)
  assert.equal(updater.calls, 2)
})
