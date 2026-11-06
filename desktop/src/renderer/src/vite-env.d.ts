/// <reference types="vite/client" />

import type { DesktopBridge } from '../../shared/contract'

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}
declare global {
  const __APP_VERSION__: string
}
