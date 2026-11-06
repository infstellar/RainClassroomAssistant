import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
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
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath:
    executable || resolve('node_modules/electron/dist/electron.exe'),
  args: [
    ...(executable ? [] : [resolve('.')]),
    `--user-data-dir=${root}`,
    '--disable-gpu',
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
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByText('设置已保存', { exact: true }).waitFor()
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
        'config persistence',
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
