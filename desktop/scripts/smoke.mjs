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
  await page.getByRole('button', { name: 'PPT 预览', exact: true }).click()
  await page.getByRole('heading', { name: '暂无已下载的 PPT 图片' }).waitFor()
  const pptDirectory = join(
    root,
    'downloads',
    'rainclasscache',
    '测试课程',
    '测试课件',
  )
  await mkdir(pptDirectory, { recursive: true })
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const context = canvas.getContext('2d')
      context.fillStyle = '#f4f8f6'
      context.fillRect(0, 0, 1280, 720)
      context.fillStyle = '#278760'
      context.fillRect(0, 0, 20, 720)
      context.font = 'bold 54px sans-serif'
      context.fillText('PPT 图片预览', 90, 220)
      context.fillStyle = '#43574c'
      context.font = '30px sans-serif'
      context.fillText('按页浏览 · 放大查看 · 本地课件', 90, 310)
      return canvas.toDataURL('image/png').split(',')[1]
    }),
    'base64',
  )
  for (const name of ['1.jpg', '2.jpg', '10.jpg'])
    await writeFile(join(pptDirectory, name), png)
  await page.getByRole('button', { name: '刷新课件', exact: true }).click()
  await page
    .getByRole('img', { name: '测试课件 第 1 页', exact: true })
    .waitFor()
  await page.waitForFunction(
    () => document.querySelector('.ppt-stage img')?.naturalWidth > 0,
  )
  assert.equal(
    await page
      .getByRole('button', { name: '上一页', exact: true })
      .isDisabled(),
    true,
  )
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page
    .getByRole('img', { name: '测试课件 第 2 页', exact: true })
    .waitFor()
  await page.getByRole('button', { name: '第 10 页', exact: true }).click()
  await page
    .getByRole('img', { name: '测试课件 第 10 页', exact: true })
    .waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: '下一页', exact: true })
      .isDisabled(),
    true,
  )
  await page.getByRole('button', { name: '放大查看', exact: true }).click()
  assert.equal(await page.locator('.ppt-stage.zoomed').count(), 1)
  await page.getByLabel('搜索课件').fill('不存在')
  await page.getByRole('heading', { name: '没有匹配的课件' }).waitFor()
  await page.getByLabel('搜索课件').fill('测试课程')
  await page
    .getByRole('img', { name: '测试课件 第 10 页', exact: true })
    .waitFor()
  await page.getByRole('button', { name: '适应窗口', exact: true }).click()
  await page.locator('.ppt-viewer').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(artifacts, 'ppt-preview.png') })
  await writeFile(join(pptDirectory, '2.jpg'), 'broken image')
  await page.getByRole('button', { name: '刷新课件', exact: true }).click()
  await page.getByRole('button', { name: '第 2 页', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '图片无法读取' }).waitFor()
  await writeFile(
    join(pptDirectory, 'presentation.json'),
    JSON.stringify({
      lessonName: '测试课程',
      title: '测试课件',
      slides: [
        { index: 1, problem: { content: '测试题目：请选择正确选项' } },
        { index: 2, problem: {} },
      ],
    }),
  )
  await mkdir(join(root, 'ai_answers_cache'), { recursive: true })
  const questionCache = join(root, 'ai_answers_cache', '测试课程_测试课件.json')
  await writeFile(
    questionCache,
    JSON.stringify({
      metadata: { lesson_name: '测试课程', presentation_title: '测试课件' },
      answers: { 1: [2] },
      manual_answers: { 1: [3], 2: [] },
    }),
  )
  await mkdir(join(root, 'ai_tasks'), { recursive: true })
  const taskFixture = {
    id: 'smoke-task',
    session: 'previous-run',
    label: '测试课件 第 1 页',
    lessonName: '测试课程',
    title: '测试课件',
    slideIndex: '1',
    signature: JSON.stringify([
      { index: '1', id: '' },
      { index: '2', id: '' },
    ]),
    model: 'test-model',
    protocol: 'responses',
    imageCount: 1,
    status: 'completed',
    startedAt: '2026-11-10T01:00:00Z',
    completedAt: '2026-11-10T01:00:02Z',
    answer: [2],
    attempts: [
      {
        number: 1,
        startedAt: '2026-11-10T01:00:00Z',
        completedAt: '2026-11-10T01:00:02Z',
        rawResponse: '{"output_text":"[2]"}',
      },
    ],
  }
  await writeFile(
    join(root, 'ai_tasks', 'smoke-task.json'),
    JSON.stringify(taskFixture),
  )
  await page.getByRole('button', { name: 'AI 任务', exact: true }).click()
  await page.getByRole('heading', { name: 'AI 任务记录' }).waitFor()
  await page.getByText('测试课件 第 1 页', { exact: true }).waitFor()
  await page.getByText('查看每次请求与原始响应', { exact: true }).click()
  assert.match(
    await page.locator('.ai-attempt pre').textContent(),
    /output_text/,
  )
  await page.screenshot({ path: join(artifacts, 'ai-tasks.png') })
  await page.getByLabel('筛选 AI 任务').selectOption('active')
  await page.getByText('当前没有正在进行的 AI 任务', { exact: true }).waitFor()
  await page.getByRole('button', { name: '题库与答案', exact: true }).click()
  await page.getByText('测试题目：请选择正确选项', { exact: true }).waitFor()
  await page.waitForFunction(
    () => document.querySelector('.question-image')?.naturalWidth > 0,
  )
  assert.equal(
    await page.locator('.question-answers strong').nth(0).textContent(),
    '2',
  )
  assert.equal(
    await page.locator('.question-answers strong').nth(1).textContent(),
    '3',
  )
  await page.getByText('原始响应记录（1）', { exact: true }).click()
  await page.getByText('查看每次请求与原始响应', { exact: true }).click()
  assert.match(
    await page.locator('.ai-attempt pre').textContent(),
    /output_text/,
  )
  await page.screenshot({ path: join(artifacts, 'question-bank.png') })
  await page.getByLabel('只看暂无答案').check()
  assert.equal(await page.locator('.question-tab').count(), 1)
  await page.getByRole('button', { name: '第 2 页 未获答案' }).click()
  await page
    .getByText('本地题图不可用，请重新下载课件。', { exact: true })
    .waitFor()
  await writeFile(
    questionCache,
    JSON.stringify({
      metadata: { lesson_name: '测试课程', presentation_title: '测试课件' },
      answers: { 1: [2], 2: [4] },
    }),
  )
  await page.getByRole('button', { name: '刷新题库', exact: true }).click()
  await page.getByText('没有匹配的题目', { exact: true }).waitFor()
  await page.getByLabel('只看暂无答案').uncheck()
  await page.getByRole('button', { name: '第 2 页 已有答案' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.question-answers strong')?.textContent === '4',
  )
  await page.getByRole('button', { name: '运行概览', exact: true }).click()
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
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai:test')
    globalThis.aiTestCalls = 0
    ipcMain.handle('ai:test', async (_event, config) => {
      globalThis.aiTestConfig = config
      globalThis.aiTestCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 150))
      return {
        ok: globalThis.aiTestCalls === 1,
        message:
          globalThis.aiTestCalls === 1
            ? '图片请求测试成功'
            : 'AI API HTTP 401: invalid key',
        elapsedMs: 150,
      }
    })
  })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('API 密钥', { exact: true }).fill('draft-test-key')
  await page.getByLabel('模型名称', { exact: true }).fill('draft-test-model')
  await page.getByRole('button', { name: '测试 AI 服务', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '测试成功' }).waitFor()
  assert.equal(
    (await app.evaluate(() => globalThis.aiTestConfig)).openai_api_key,
    'draft-test-key',
  )
  assert.equal(
    (await app.evaluate(() => globalThis.aiTestConfig)).openai_model,
    'draft-test-model',
  )
  await page.getByRole('button', { name: '测试 AI 服务', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'HTTP 401' }).waitFor()
  await page
    .locator('.ai-service-test')
    .screenshot({ path: join(artifacts, 'ai-service-test.png') })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      success: true,
      checked: [
        'renderer',
        'preload IPC',
        'downloaded PPT preview, numeric paging, zoom, search and corrupt images',
        'help',
        '42 settings fields',
        '18px text and responsive layout',
        'hover/focus help and Escape dismissal',
        'automatic config persistence and navigation',
        'save success, validation and failure toasts',
        'retry and in-flight edit preservation',
        'log level and text filtering',
        'QR refresh',
        'question images, manual priority, unanswered filter and refreshed answers',
        'AI service test with draft config, success and failure',
      ],
      artifacts,
    }),
  )
} finally {
  await app.close()
  await rm(root, { recursive: true, force: true })
}
