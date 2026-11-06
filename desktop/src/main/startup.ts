import type { App } from 'electron'

export function loginItemOptions(executable: string) {
  return { path: executable, args: [] as string[] }
}

// Verify the registration before reporting a successful settings save.
export function setOpenAtLogin(
  app: Pick<App, 'setLoginItemSettings' | 'getLoginItemSettings'>,
  executable: string,
  enabled: boolean,
) {
  const options = loginItemOptions(executable)
  app.setLoginItemSettings({ ...options, openAtLogin: enabled, enabled })
  const actual = app.getLoginItemSettings(options)
  if (
    actual.openAtLogin !== enabled ||
    (enabled && !actual.executableWillLaunchAtLogin)
  ) {
    throw new Error('开机自启设置失败，请检查 Windows 启动应用设置')
  }
}

export async function initializeMonitoring(
  automatic: boolean,
  runtime: { start(): Promise<unknown>; validateSession(): Promise<unknown> },
) {
  // start() validates the saved session itself and leaves listening off on failure.
  if (automatic) await runtime.start()
  else await runtime.validateSession()
}
