import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'

const root = await mkdtemp(join(tmpdir(), 'rainclass-desktop-smoke-'))
const artifacts = resolve('test-results')
await mkdir(join(root, 'logs'), { recursive: true })
await mkdir(artifacts, { recursive: true })
const logs = [
  {
    id: 'info',
    time: '2026/11/6 00:00:00',
    level: 'INFO',
    source: 'Smoke',
    message: '正常事件',
  },
  {
    id: 'error',
    time: '2026/11/6 00:00:01',
    level: 'ERROR',
    source: 'Smoke',
    message: '测试错误\n多行消息',
  },
]
await writeFile(
  join(root, 'logs', 'RainClassroomAssistant.jsonl'),
  logs.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
)
const executable = process.env.RAINCLASSROOM_EXECUTABLE
// Electron 45 downloads its runtime lazily through this entrypoint.
// A hard-coded dist path skips that installation on a clean CI runner.
const electronExecutable =
  executable || createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: electronExecutable,
  args: [
    ...(executable ? [] : [resolve('.')]),
    `--user-data-dir=${root}`,
    '--disable-gpu',
    '--enable-logging=stderr',
  ],
  env,
  timeout: 30000,
})
const errors = []
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '运行概览', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => typeof window.desktop?.getConfig),
    'function',
  )
  assert.equal(
    (await page.evaluate(() => window.desktop.getConfig())).sessionid,
    '',
  )
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  assert.match(
    (await page.evaluate(() => window.desktop.getUpdateState())).message,
    /手动下载/,
  )
  await page.getByRole('button', { name: '版本下载', exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'overview.png') })
  await page.getByRole('button', { name: '帮助', exact: true }).click()
  await page.getByRole('heading', { name: '使用帮助' }).waitFor()
  await page.getByRole('button', { name: '知道了' }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '账号与平台', exact: true }).waitFor()
  assert.equal(
    await page
      .locator('.field-row input')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    '18px',
  )
  const hint = page.getByRole('button', {
    name: '签到延迟策略说明',
    exact: true,
  })
  const tip = page
    .getByRole('tooltip')
    .filter({ hasText: '选择进入课堂前是否等待' })
  await hint.hover()
  await tip.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(artifacts, 'settings-tooltip.png') })
  await hint.focus()
  await hint.press('Escape')
  await tip.waitFor({ state: 'hidden' })
  await hint.blur()
  await hint.focus()
  await tip.waitFor({ state: 'visible' })
  await hint.blur()
  await page.mouse.move(0, 0)
  for (const width of [1440, 1100, 900]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setMinimumSize(800, 600)
      BrowserWindow.getAllWindows()[0].setSize(width, 900)
    }, width)
    await page.waitForFunction((width) => window.innerWidth <= width, width)
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `settings overflow at ${width}px`,
    )
  }
  assert.ok((await page.locator('input,select').count()) >= 42)
  assert.equal(
    await page.getByLabel('开机自启', { exact: true }).isEnabled(),
    false,
  )
  await page.getByLabel('启动时自动开始监听', { exact: true }).check()
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()
  assert.equal(
    JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
      .auto_start_monitoring,
    true,
  )
  assert.equal(
    (await page.evaluate(() => window.desktop.getRuntimeState())).listening,
    false,
  )
  await page.getByLabel('启动时自动开始监听', { exact: true }).uncheck()
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()
  const enabledBeforeHint = await page
    .getByLabel('启用自动答题', { exact: true })
    .isChecked()
  await page
    .getByRole('button', { name: '启用自动答题说明', exact: true })
    .click()
  assert.equal(
    await page.getByLabel('启用自动答题', { exact: true }).isChecked(),
    enabledBeforeHint,
  )
  await page.getByLabel('启用自动答题', { exact: true }).uncheck()
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.desktop.getConfig())).auto_answer,
    false,
  )
  assert.equal(
    JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).auto_answer,
    false,
  )
  await page.screenshot({
    path: join(artifacts, 'settings.png'),
    fullPage: true,
  })
  await page.getByLabel('最大重试次数', { exact: true }).fill('7')
  await page.getByLabel('最大重试次数', { exact: true }).fill('8')
  await page.getByRole('button', { name: '运行概览', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()
  assert.equal(
    JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
      .ai_analysis_settings.max_retries,
    8,
  )
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('启用 AI 分析', { exact: true }).check()
  await page.getByRole('alert').filter({ hasText: '请补全' }).waitFor()
  assert.equal(
    JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
      .enable_ai_analysis,
    false,
  )
  await page.getByLabel('启用 AI 分析', { exact: true }).uncheck()
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()

  // Simulate a failed write, retry, then edit during a slow save.
  await app.evaluate(({ ipcMain }) => {
    globalThis.smokeSaves = []
    globalThis.smokeSaveFails = true
    ipcMain.removeHandler('config:save')
    ipcMain.handle('config:save', async (_event, config) => {
      if (globalThis.smokeSaveFails) throw new Error('simulated disk failure')
      globalThis.smokeSaves.push(config.ai_analysis_settings.max_retries)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return config
    })
  })
  await page.getByLabel('最大重试次数', { exact: true }).fill('6')
  await page
    .getByRole('alert')
    .filter({ hasText: '检查权限和磁盘状态' })
    .waitFor()
  assert.equal(
    await page.getByLabel('最大重试次数', { exact: true }).inputValue(),
    '6',
  )
  await app.evaluate(() => {
    globalThis.smokeSaveFails = false
  })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  // Wait until the retry is in flight before making the next edit.
  const deadline = Date.now() + 10000
  while (!(await app.evaluate(() => globalThis.smokeSaves.length))) {
    assert.ok(Date.now() < deadline, 'retry did not start')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await page.getByLabel('最大重试次数', { exact: true }).fill('5')
  await page.getByRole('status').filter({ hasText: '设置已自动保存' }).waitFor()
  assert.equal(
    await page.getByLabel('最大重试次数', { exact: true }).inputValue(),
    '5',
  )
  assert.deepEqual(await app.evaluate(() => globalThis.smokeSaves), [6, 5])
  await page.getByRole('button', { name: /运行日志/ }).click()
  await page.getByLabel('日志级别', { exact: true }).selectOption('ERROR')
  await page.getByText('测试错误', { exact: false }).waitFor()
  assert.equal(await page.getByText('正常事件', { exact: true }).count(), 0)
  await page.getByPlaceholder('搜索日志').fill('不存在的消息')
  await page.getByText('没有匹配的日志', { exact: true }).waitFor()
  await page.getByPlaceholder('搜索日志').fill('')
  await page.screenshot({ path: join(artifacts, 'logs.png') })
  await app.evaluate(({ ipcMain }) => {
    globalThis.smokeLoginCalls = 0
    ipcMain.removeHandler('login:begin')
    ipcMain.handle('login:begin', (event) => {
      globalThis.smokeLoginCalls += 1
      event.sender.send('login:update', {
        status: 'qr',
        message: '测试二维码已刷新',
      })
    })
  })
  await page.getByRole('button', { name: '扫码登录', exact: true }).click()
  await page.getByRole('button', { name: '获取二维码', exact: true }).click()
  await page.getByText('测试二维码已刷新', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '刷新二维码', exact: true }).click()
  assert.equal(await app.evaluate(() => globalThis.smokeLoginCalls), 2)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      success: true,
      checked: [
        'renderer',
        'preload IPC',
        'help',
        '42 settings fields',
        '18px text and responsive layout',
        'hover/focus help and Escape dismissal',
        'automatic config persistence and navigation',
        'save success, validation and failure toasts',
        'retry and in-flight edit preservation',
        'log level and text filtering',
        'QR refresh',
      ],
      artifacts,
    }),
  )
} finally {
  await app.close()
  await rm(root, { recursive: true, force: true })
}
