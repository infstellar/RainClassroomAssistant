import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantConfig } from '../../shared/contract'

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid'
type Toast = { kind: 'success' | 'error'; message: string }

export function useAutoSaveConfig(
  isValid: (config: AssistantConfig) => boolean,
) {
  const [config, setConfig] = useState<AssistantConfig | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [toast, setToast] = useState<Toast | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(config)
  const persisted = useRef(config)
  const writes = useRef<Promise<void>>(Promise.resolve())

  const loadConfig = useCallback((saved: AssistantConfig) => {
    latest.current = persisted.current = saved
    setConfig(saved)
    setSaveState('idle')
  }, [])

  const updateConfig = (next: AssistantConfig) => {
    latest.current = next
    setConfig(next)
    setSaveState('pending')
    setToast(null)
  }

  useEffect(() => {
    if (!config || config === persisted.current || !window.desktop) return
    const snapshot = config
    const timer = window.setTimeout(() => {
      if (!isValid(snapshot)) {
        setSaveState('invalid')
        setToast({
          kind: 'error',
          message: '自动保存失败：请补全已启用功能的必填配置，并检查端口范围',
        })
        return
      }
      // Serialize IPC requests so an older write cannot replace a newer edit.
      writes.current = writes.current.then(async () => {
        if (latest.current !== snapshot) return
        setSaveState('saving')
        try {
          const saved = await window.desktop!.saveConfig(snapshot)
          persisted.current = saved
          // A completed request must never overwrite input typed while saving.
          if (latest.current !== snapshot) return
          latest.current = saved
          setConfig(saved)
          setSaveState('saved')
          setToast({ kind: 'success', message: '设置已自动保存' })
        } catch (error) {
          if (latest.current !== snapshot) return
          setSaveState('error')
          setToast({
            kind: 'error',
            message:
              error instanceof Error && error.message.includes('开机自启')
                ? `自动保存失败：${error.message.slice(error.message.indexOf('开机自启'))}`
                : '自动保存失败，请检查权限和磁盘状态后重试',
          })
        }
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [config, attempt, isValid])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(
      () => setToast(null),
      toast.kind === 'success' ? 3000 : 6000,
    )
    return () => window.clearTimeout(timer)
  }, [toast])

  return {
    config,
    loadConfig,
    updateConfig,
    saveState,
    toast,
    dismissToast: () => setToast(null),
    retrySave: () => {
      setSaveState('pending')
      setAttempt((value) => value + 1)
    },
  }
}
