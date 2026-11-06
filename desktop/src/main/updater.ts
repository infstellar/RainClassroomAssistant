import type { AppUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/contract.ts'

type Updater = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'checkForUpdates'
  | 'quitAndInstall'
> & { on(...args: Parameters<AppUpdater['on']>): unknown }

export class UpdateController {
  state: UpdateState = { status: 'not-available' }
  private updater: Updater
  private enabled: boolean
  private publish: (state: UpdateState) => void
  private log: (level: 'INFO' | 'WARNING', message: string) => void
  private pending: Promise<void> | null = null
  private startup?: NodeJS.Timeout
  private interval?: NodeJS.Timeout

  constructor(
    updater: Updater,
    enabled: boolean,
    publish: (state: UpdateState) => void,
    log: (level: 'INFO' | 'WARNING', message: string) => void,
  ) {
    this.updater = updater
    this.enabled = enabled
    this.publish = publish
    this.log = log
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.on('checking-for-update', () => this.set({ status: 'checking' }))
    updater.on('update-available', ({ version }: { version: string }) => {
      this.set({ status: 'available', version })
      log('INFO', `发现新版本 ${version}，正在下载`)
    })
    updater.on('update-not-available', ({ version }: { version: string }) =>
      this.set({
        status: 'not-available',
        version,
        message: '当前已是最新版本',
      }),
    )
    updater.on('download-progress', ({ percent }: { percent: number }) =>
      this.set({ status: 'downloading', percent: Math.round(percent) }),
    )
    updater.on('update-downloaded', ({ version }: { version: string }) => {
      this.set({ status: 'downloaded', version })
      log('INFO', `新版本 ${version} 已下载，退出时安装或点击重启并安装`)
    })
    updater.on('error', (error: Error) => this.fail(error))
  }

  private set(state: UpdateState) {
    this.state = state
    this.publish(state)
  }

  private fail(error: Error) {
    // The library emits errors and also rejects checkForUpdates with the same error.
    if (this.state.status === 'error') return
    this.set({
      status: 'error',
      message: '更新检查或下载失败，请重试或访问发布页',
    })
    this.log('WARNING', error.message.split(/\r?\n/, 1)[0].slice(0, 240))
  }

  async check(): Promise<UpdateState> {
    if (!this.enabled) {
      this.set({
        status: 'not-available',
        message: '当前运行方式请从发布页手动下载新版',
      })
      return this.state
    }
    if (['available', 'downloading', 'downloaded'].includes(this.state.status))
      return this.state
    if (!this.pending) {
      this.set({ status: 'checking' })
      this.pending = Promise.resolve()
        .then(() => this.updater.checkForUpdates())
        .then(() => undefined)
        .catch((error: Error) => this.fail(error))
        .finally(() => {
          this.pending = null
        })
    }
    await this.pending
    return this.state
  }

  start() {
    this.stop()
    if (!this.enabled) {
      void this.check()
      return
    }
    this.startup = setTimeout(() => void this.check(), 5000)
    this.interval = setInterval(() => void this.check(), 4 * 60 * 60 * 1000)
    this.startup.unref()
    this.interval.unref()
  }

  stop() {
    clearTimeout(this.startup)
    clearInterval(this.interval)
  }

  install() {
    if (!this.enabled || this.state.status !== 'downloaded')
      throw new Error('更新尚未下载完成')
    this.updater.quitAndInstall()
  }
}
