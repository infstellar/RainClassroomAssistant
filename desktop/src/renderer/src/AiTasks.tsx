import { useEffect, useState } from 'react'
import type { AiTask } from '../../shared/contract'

const labels = {
  running: '正在请求',
  retrying: '等待重试',
  completed: '已完成',
  failed: '未获答案',
  interrupted: '已中断',
}
const active = (task: AiTask) => ['running', 'retrying'].includes(task.status)
const time = (value?: string) =>
  value ? new Date(value).toLocaleString() : '—'

export function AiHistory({ tasks }: { tasks: AiTask[] }) {
  return (
    <div className="ai-task-list">
      {tasks.map((task) => (
        <article className="ai-task-card" key={task.id}>
          <div className="ai-task-heading">
            <strong>{task.label}</strong>
            <span className={`ai-task-status ${task.status}`}>
              {labels[task.status]}
            </span>
          </div>
          <p>
            {task.lessonName || '服务测试'} · {task.model} · {task.protocol} ·{' '}
            {task.imageCount} 张图片
          </p>
          <p>
            开始：{time(task.startedAt)} · 完成：{time(task.completedAt)} ·
            已请求 {task.attempts.length} 次
          </p>
          {task.answer && <p>解析答案：{JSON.stringify(task.answer)}</p>}
          {task.error && <p role="status">{task.error}</p>}
          <details>
            <summary>查看每次请求与原始响应</summary>
            {task.attempts.map((attempt) => (
              <div className="ai-attempt" key={attempt.number}>
                <strong>第 {attempt.number} 次请求</strong>
                <p>
                  {time(attempt.startedAt)} → {time(attempt.completedAt)}
                </p>
                {attempt.error && <p>{attempt.error}</p>}
                <pre>{attempt.rawResponse || '尚未收到响应记录'}</pre>
              </div>
            ))}
          </details>
        </article>
      ))}
    </div>
  )
}

export function AiTasks() {
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const data = (await window.desktop?.getAiTasks()) ?? []
        if (mounted) {
          setTasks(data)
          setError('')
        }
      } catch {
        if (mounted) setError('任务读取失败，请刷新重试')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [revision])
  const running = tasks.filter(active)
  const visible = tasks
    .filter(
      (task) =>
        filter === 'all' ||
        (filter === 'active' ? active(task) : !active(task)),
    )
    .sort((a, b) => Number(active(b)) - Number(active(a)))
  return (
    <section className="panel ai-tasks">
      <div className="panel-heading">
        <div>
          <h2>AI 任务记录</h2>
          <p>
            每 2 秒刷新，正在进行 {running.length} 项，共 {tasks.length}{' '}
            项。上下文补充会单独记录请求。
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          刷新任务
        </button>
      </div>
      <label className="ai-task-filter">
        显示任务{' '}
        <select
          aria-label="筛选 AI 任务"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">全部任务</option>
          <option value="active">正在进行</option>
          <option value="history">历史记录</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">正在读取任务…</p>
      ) : visible.length ? (
        <AiHistory tasks={visible} />
      ) : (
        <div className="question-empty">
          {filter === 'active'
            ? '当前没有正在进行的 AI 任务'
            : '暂无任务记录，开始 AI 分析后会显示在这里。'}
        </div>
      )}
    </section>
  )
}
