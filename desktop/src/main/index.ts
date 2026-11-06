import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import WebSocket from 'ws'
import { normalizeConfig } from '../shared/config'
import type { AssistantConfig } from '../shared/contract'
import { ClassroomRuntime } from './runtime'
import { AppLogger } from './logger'
import { sendTestEmail } from './notifier'
import { createRequire } from 'node:module'
import { UpdateController } from './updater'
import { copyLegacyDirectory } from './migration'
import { loginImageMime } from './login-image'
import {
  initializeMonitoring,
  loginItemOptions,
  setOpenAtLogin,
} from './startup'

let mainWindow: BrowserWindow | null = null
let loginSocket: WebSocket | null = null
let loginExpiry: NodeJS.Timeout | null = null
const isolatedData = app.commandLine.getSwitchValue('user-data-dir')
if (isolatedData) {
  if (!isAbsolute(isolatedData)) throw new Error('user-data-dir 必须是绝对路径')
  app.setPath('userData', resolve(isolatedData))
}
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
})
const { autoUpdater } = createRequire(import.meta.url)(
  'electron-updater',
) as typeof import('electron-updater')
const logDirectory = () => join(app.getPath('userData'), 'logs')
const userDataPath = () => app.getPath('userData')
const logger = new AppLogger(logDirectory(), (entry) =>
  mainWindow?.webContents.send('logs:entry', entry),
)
const runtime = new ClassroomRuntime(
  readConfig,
  logger,
  (state) => mainWindow?.webContents.send('runtime:state', state),
  (message) => mainWindow?.webContents.send('notification:speak', message),
  userDataPath,
)

const configPath = () => join(app.getPath('userData'), 'config.json')
let configWrites = Promise.resolve()

async function readConfig(): Promise<AssistantConfig> {
  try {
    const content = await readFile(configPath(), 'utf8')
    return normalizeConfig(JSON.parse(content))
  } catch (error) {
    if (error instanceof SyntaxError) {
      await rename(configPath(), `${configPath()}.invalid-${Date.now()}`).catch(
        () => undefined,
      )
      await logger.write(
        'WARNING',
        '配置',
        '配置文件格式损坏，已保留备份并恢复默认设置',
      )
      return normalizeConfig(undefined)
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (isolatedData) return normalizeConfig(undefined)

  const legacyCandidates = [
    join(app.getPath('appData'), 'RainClassroomAssistant', 'config.json'),
    join(app.getAppPath(), '..', 'config.json'),
    join(process.cwd(), 'config.json'),
  ]
  for (const legacyPath of new Set(legacyCandidates)) {
    try {
      await access(legacyPath)
      const legacy = normalizeConfig(
        JSON.parse(await readFile(legacyPath, 'utf8')),
      )
      await writeConfig(legacy)
      await logger.write('INFO', '配置', '已将现有配置导入桌面端用户数据目录')
      return legacy
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await logger.write('WARNING', '配置', '无法读取旧配置，使用默认配置')
      }
    }
  }
  return normalizeConfig(undefined)
}

function writeConfig(config: AssistantConfig): Promise<AssistantConfig> {
  const target = configPath()
  const directory = join(target, '..')
  const temporary = `${target}.${process.pid}.tmp`
  const normalized = normalizeConfig(config)
  const task = configWrites.then(async () => {
    await mkdir(directory, { recursive: true })
    await writeFile(
      temporary,
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf8',
    )
    await rename(temporary, target)
    return normalized
  })
  configWrites = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f4f6f8',
    title: '摸鱼课堂',
    icon: join(process.resourcesPath, 'favicon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      const message = `页面加载失败 ${errorCode} (${errorDescription}): ${validatedURL}`
      console.error(message)
      void logger.write('ERROR', '窗口', message)
    },
  )
  window.webContents.on('render-process-gone', (_event, details) => {
    const message = `渲染进程退出：${details.reason} (${details.exitCode})`
    console.error(message)
    void logger.write('ERROR', '窗口', message)
  })
  window.webContents.on('did-finish-load', () => {
    void logger.write('INFO', '窗口', '桌面界面已就绪')
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window
      .loadURL(process.env.ELECTRON_RENDERER_URL)
      .catch((error: unknown) => reportWindowLoadError(error))
  } else {
    void window
      .loadFile(join(__dirname, '../renderer/index.html'))
      .catch((error: unknown) => reportWindowLoadError(error))
  }
}

function reportWindowLoadError(error: unknown) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error)
  const message = `无法打开桌面界面。\n\n${detail}`
  console.error(message)
  void appendFile(
    join(app.getPath('temp'), 'RainClassroomAssistant-startup-error.log'),
    `${new Date().toISOString()}\n${message}\n\n`,
    'utf8',
  )
  void logger.write('ERROR', '窗口', message)
  dialog.showErrorBox('摸鱼课堂启动失败', message)
}

ipcMain.handle('runtime:get-state', () => runtime.getState())
ipcMain.handle('runtime:get-courses', () => runtime.getCourses())
ipcMain.handle('runtime:start', () => runtime.start())
ipcMain.handle('runtime:stop', () => runtime.stop())
ipcMain.handle('logs:get-all', () => logger.list())
ipcMain.handle('config:get', () => readConfig())
const supportsOpenAtLogin = () =>
  process.platform === 'win32' && app.isPackaged && !isolatedData
const startupExecutable = () =>
  process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
ipcMain.handle('startup:supported', supportsOpenAtLogin)
ipcMain.handle('config:save', async (_event, config: AssistantConfig) => {
  const before = await readConfig()
  const normalized = normalizeConfig(config)
  const accountChanged =
    before.sessionid !== normalized.sessionid ||
    String(before.region) !== String(normalized.region)
  if (accountChanged) await runtime.stop()
  const startupChanged = before.open_at_login !== normalized.open_at_login
  if (startupChanged && !supportsOpenAtLogin()) {
    throw new Error('开机自启仅支持打包后的 Windows 程序')
  }
  const executable = startupExecutable()
  const previousStartup = startupChanged
    ? app.getLoginItemSettings(loginItemOptions(executable)).openAtLogin
    : false
  let saved: AssistantConfig
  try {
    if (startupChanged)
      setOpenAtLogin(app, executable, normalized.open_at_login)
    saved = await writeConfig(normalized)
  } catch (error) {
    if (startupChanged) {
      try {
        setOpenAtLogin(app, executable, previousStartup)
      } catch {
        await logger.write(
          'ERROR',
          '启动设置',
          '恢复开机自启设置失败，请检查 Windows 启动应用设置',
        )
      }
    }
    throw error
  }
  if (accountChanged) await runtime.validateSession()
  return saved
})
ipcMain.handle('email:test', async (_event, config: AssistantConfig) =>
  sendTestEmail(config, logger),
)
ipcMain.handle('logs:open-folder', async () => {
  await shell.openPath(logDirectory())
})
function cancelLogin() {
  const previous = loginSocket
  loginSocket = null
  if (loginExpiry) clearTimeout(loginExpiry)
  loginExpiry = null
  previous?.close()
}
ipcMain.handle('login:cancel', () => {
  cancelLogin()
  mainWindow?.webContents.send('login:update', {
    status: 'closed',
    message: '登录已取消',
  })
})
ipcMain.handle('update:open-release', () =>
  shell.openExternal(
    'https://github.com/infstellar/RainClassroomAssistant/releases/latest',
  ),
)
ipcMain.handle('update:get-state', () => updates.state)
ipcMain.handle('update:check', () => updates.check())
ipcMain.handle('update:install', () => updates.install())
ipcMain.handle('login:begin', async (_event, region: number) => {
  const hosts = [
    'www.yuketang.cn',
    'pro.yuketang.cn',
    'changjiang.yuketang.cn',
    'huanghe.yuketang.cn',
  ]
  if (!Number.isInteger(region) || !hosts[region])
    throw new Error('平台选择无效')
  cancelLogin()
  mainWindow?.webContents.send('login:update', {
    status: 'connecting',
    message: '正在连接登录服务',
  })
  const socket = new WebSocket(`wss://${hosts[region]}/wsapp/`)
  loginSocket = socket
  loginExpiry = setTimeout(() => {
    if (loginSocket !== socket) return
    cancelLogin()
    mainWindow?.webContents.send('login:update', {
      status: 'error',
      message: '二维码已过期，请重新获取',
    })
  }, 120000)
  socket.on('open', () => {
    if (loginSocket === socket)
      socket.send(
        JSON.stringify({
          op: 'requestlogin',
          role: 'web',
          version: 1.4,
          type: 'qrcode',
          from: 'web',
        }),
      )
  })
  socket.on('message', async (raw) => {
    if (loginSocket !== socket) return
    try {
      const data = JSON.parse(raw.toString()) as Record<string, unknown>
      if (data.op === 'requestlogin' && typeof data.ticket === 'string') {
        const ticketUrl = new URL(data.ticket)
        if (ticketUrl.protocol !== 'https:') throw new Error('二维码地址无效')
        const image = await fetch(ticketUrl, {
          signal: AbortSignal.timeout(15000),
        })
        if (!image.ok) throw new Error(`二维码加载失败：HTTP ${image.status}`)
        const bytes = Buffer.from(await image.arrayBuffer())
        if (bytes.length > 5 * 1024 * 1024) throw new Error('二维码图片过大')
        const mime = loginImageMime(bytes)
        if (!mime) throw new Error('二维码服务未返回有效图片，请重试')
        const encoded = bytes.toString('base64')
        if (loginSocket !== socket) return
        mainWindow?.webContents.send('login:update', {
          status: 'qr',
          image: `data:${mime};base64,${encoded}`,
          message: '使用微信扫码登录',
        })
      } else if (
        data.op === 'loginsuccess' &&
        (typeof data.UserID === 'string' || typeof data.UserID === 'number') &&
        typeof data.Auth === 'string'
      ) {
        const response = await fetch(`https://${hosts[region]}/pc/web_login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          body: JSON.stringify({ UserID: data.UserID, Auth: data.Auth }),
          signal: AbortSignal.timeout(15000),
        })
        const cookie = response.headers
          .getSetCookie()
          .find((value) => /^sessionid=/.test(value))
        const sessionid = cookie?.match(/^sessionid=([^;]+)/)?.[1]
        if (!response.ok || !sessionid)
          throw new Error('登录成功，但未能取得有效会话')
        if (loginSocket !== socket) return
        const config = await readConfig()
        if (loginSocket !== socket) return
        await runtime.stop()
        config.sessionid = sessionid
        config.region = region
        await writeConfig(config)
        if (loginSocket !== socket) return
        mainWindow?.webContents.send('login:update', {
          status: 'success',
          message: '登录成功，设置已保存',
        })
        await runtime.validateSession()
        if (loginSocket === socket) cancelLogin()
      }
    } catch (error) {
      if (loginSocket !== socket) return
      mainWindow?.webContents.send('login:update', {
        status: 'error',
        message: error instanceof Error ? error.message : '登录处理失败',
      })
    }
  })
  socket.on('error', () => {
    if (loginSocket === socket)
      mainWindow?.webContents.send('login:update', {
        status: 'error',
        message: '登录服务连接失败',
      })
  })
  socket.on('close', () => {
    if (loginSocket !== socket) return
    loginSocket = null
    if (loginExpiry) clearTimeout(loginExpiry)
    loginExpiry = null
    mainWindow?.webContents.send('login:update', {
      status: 'closed',
      message: '登录连接已关闭，请重新获取二维码',
    })
  })
})

const updates = new UpdateController(
  autoUpdater,
  app.isPackaged && !isolatedData && !process.env.PORTABLE_EXECUTABLE_DIR,
  (state) => mainWindow?.webContents.send('update:state', state),
  (level, message) => {
    void logger.write(level, '软件更新', message)
  },
)
app.on('before-quit', () => updates.stop())

if (hasInstanceLock)
  app
    .whenReady()
    .then(async () => {
      if (!isolatedData) await migrateUserFiles()
      await logger.load()
      createWindow()
      void readConfig()
        .then((config) =>
          initializeMonitoring(config.auto_start_monitoring, runtime),
        )
        .catch((error) =>
          logger.write(
            'ERROR',
            '登录',
            error instanceof Error ? error.message : '读取账号配置失败',
          ),
        )
      updates.start()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch(reportWindowLoadError)

async function migrateUserFiles() {
  const legacyRoots = [
    join(app.getPath('appData'), 'RainClassroomAssistant'),
    process.cwd(),
    join(app.getAppPath(), '..'),
  ]
  for (const directory of ['ai_answers_cache', 'downloads']) {
    const target = join(userDataPath(), directory)
    for (const root of new Set(legacyRoots)) {
      try {
        if (await copyLegacyDirectory(join(root, directory), target)) {
          await logger.write('INFO', '数据迁移', `已导入旧版 ${directory} 数据`)
          break
        }
      } catch (error) {
        await logger.write(
          'WARNING',
          '数据迁移',
          `导入旧版 ${directory} 数据失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
    }
  }
}

app.on('window-all-closed', () => {
  cancelLogin()
  void runtime.stop()
  if (process.platform !== 'darwin') app.quit()
})
