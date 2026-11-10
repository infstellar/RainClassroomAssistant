import { useState } from 'react'
import type {
  AiServiceTestResult,
  AssistantConfig,
} from '../../shared/contract'

export function AiServiceTest({ config }: { config: AssistantConfig }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AiServiceTestResult | null>(null)
  const [testedConfig, setTestedConfig] = useState('')
  const fingerprint = JSON.stringify([
    config.openai_api_base,
    config.openai_api_key,
    config.openai_model,
    config.ai_analysis_settings,
  ])
  const currentResult = testedConfig === fingerprint ? result : null
  return (
    <div className="ai-service-test">
      <p>使用当前填写的配置发送一次图片测试请求，可能产生少量 API 费用。</p>
      <button
        className="button secondary"
        disabled={
          busy ||
          !window.desktop ||
          !config.openai_api_key.trim() ||
          !config.openai_model.trim() ||
          !config.openai_api_base.trim()
        }
        onClick={async () => {
          if (!window.desktop) return
          setBusy(true)
          setResult(null)
          setTestedConfig(fingerprint)
          try {
            setResult(await window.desktop.testAi(config))
          } catch {
            setResult({
              ok: false,
              message: '测试调用失败，请查看运行日志',
              elapsedMs: 0,
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? '正在测试 AI 服务…' : '测试 AI 服务'}
      </button>
      {currentResult && (
        <p
          role={currentResult.ok ? 'status' : 'alert'}
          className={currentResult.ok ? 'ai-test-success' : 'ai-test-error'}
        >
          {currentResult.ok ? '测试成功' : '测试失败'} ·{' '}
          {(currentResult.elapsedMs / 1000).toFixed(1)} 秒 ·{' '}
          {currentResult.message}
        </p>
      )}
    </div>
  )
}
