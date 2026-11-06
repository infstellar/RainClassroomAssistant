import assert from 'node:assert/strict'
import test from 'node:test'
import type { App } from 'electron'
import { initializeMonitoring, setOpenAtLogin } from './startup.ts'
import { ClassroomRuntime } from './runtime.ts'
import { normalizeConfig } from '../shared/config.ts'
import type { AppLogger } from './logger.ts'

test('registers and removes the exact executable path, including portable paths with spaces', () => {
  let enabled = false
  const executable = 'D:\\Portable Apps\\摸鱼课堂.exe'
  const api = {
    setLoginItemSettings(options: Electron.Settings) {
      assert.equal(options.path, executable)
      assert.deepEqual(options.args, [])
      enabled = options.openAtLogin === true
      assert.equal(options.enabled, enabled)
    },
    getLoginItemSettings(options: Electron.LoginItemSettingsOptions) {
      assert.equal(options.path, executable)
      assert.deepEqual(options.args, [])
      return { openAtLogin: enabled, executableWillLaunchAtLogin: enabled }
    },
  } as unknown as Pick<App, 'setLoginItemSettings' | 'getLoginItemSettings'>
  setOpenAtLogin(api, executable, true)
  assert.equal(enabled, true)
  setOpenAtLogin(api, executable, false)
  assert.equal(enabled, false)
})

test('does not report success when Windows refuses or disables the startup item', () => {
  const api = {
    setLoginItemSettings() {},
    getLoginItemSettings() {
      return { openAtLogin: true, executableWillLaunchAtLogin: false }
    },
  } as unknown as Pick<App, 'setLoginItemSettings' | 'getLoginItemSettings'>
  assert.throws(
    () => setOpenAtLogin(api, 'C:\\app.exe', true),
    /开机自启设置失败/,
  )
})

test('startup monitoring honors the preference and validates the saved session', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  let session = 'saved-test-session'
  const runtime = new ClassroomRuntime(
    async () => normalizeConfig({ sessionid: session }),
    { write: async () => undefined } as unknown as AppLogger,
    () => undefined,
  )
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    return Response.json(
      url.endsWith('basic-info')
        ? { code: 0, data: { id: 'test', name: 'Test' } }
        : { code: 0, data: { onLessonClassrooms: [] } },
    )
  }
  try {
    await initializeMonitoring(false, runtime)
    assert.equal(runtime.getState().connected, true)
    assert.equal(runtime.getState().listening, false)
    assert.equal(requests.length, 1)
    await initializeMonitoring(true, runtime)
    assert.equal(runtime.getState().listening, true)
    assert.ok(requests.some((url) => url.endsWith('on-lesson')))
    await runtime.stop()
    session = ''
    await initializeMonitoring(true, runtime)
    assert.equal(runtime.getState().listening, false)
    assert.match(runtime.getState().error!, /尚未登录/)
    session = 'expired'
    globalThis.fetch = async () => Response.json({ code: 1 })
    await initializeMonitoring(true, runtime)
    assert.equal(runtime.getState().listening, false)
    assert.match(runtime.getState().error!, /已过期/)
  } finally {
    await runtime.stop()
    globalThis.fetch = originalFetch
  }
})
