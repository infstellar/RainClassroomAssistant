import { useEffect, useState } from 'react'
import { AiHistory } from './AiTasks'
import type { QuestionDeck, QuestionEntry } from '../../shared/contract'

const statusLabels = {
  answered: '已有答案',
  unanswered: '待分析',
  failed: '未获答案',
  context: '上下文不足',
}

function formatAnswer(answer: unknown[] | null) {
  if (!answer) return '暂无答案'
  return answer
    .map((value) =>
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    )
    .join('、')
}

export function QuestionBank() {
  const [decks, setDecks] = useState<QuestionDeck[]>([])
  const [deckId, setDeckId] = useState('')
  const [questions, setQuestions] = useState<QuestionEntry[]>([])
  const [index, setIndex] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [onlyUnanswered, setOnlyUnanswered] = useState(false)
  const [revision, setRevision] = useState(0)
  const [manualDraft, setManualDraft] = useState('')
  const [savingAnswer, setSavingAnswer] = useState(false)
  const [answerMessage, setAnswerMessage] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    if (!window.desktop) {
      setLoading(false)
      return
    }
    void window.desktop
      .getQuestionDecks()
      .then((data) => {
        if (!active) return
        setDecks(data)
        setDeckId((current) =>
          data.some((deck) => deck.id === current)
            ? current
            : (data[0]?.id ?? ''),
        )
        setError('')
      })
      .catch(() => {
        if (active) setError('题库读取失败，请刷新重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision])

  useEffect(() => {
    let active = true
    setQuestions([])
    setIndex('')
    if (!deckId || !window.desktop) return
    const load = () =>
      window
        .desktop!.getQuestions(deckId)
        .then((data) => {
          if (!active) return
          setQuestions(data)
          setIndex((current) =>
            data.some((question) => question.index === current)
              ? current
              : (data[0]?.index ?? ''),
          )
          setError('')
        })
        .catch(() => {
          if (active) setError('题目读取失败，请刷新重试')
        })
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [deckId, revision])

  useEffect(() => {
    let active = true
    setImage(null)
    setImageLoading(false)
    if (!deckId || !index || !window.desktop) return
    setImageLoading(true)
    void window.desktop
      .getQuestionImage(deckId, index)
      .then((data) => {
        if (active) setImage(data)
      })
      .catch(() => {
        if (active) setImage(null)
      })
      .finally(() => {
        if (active) setImageLoading(false)
      })
    return () => {
      active = false
    }
  }, [deckId, index, revision])

  const question = questions.find((item) => item.index === index)
  useEffect(() => {
    if (!question) return
    setManualDraft(
      question.source === 'manual' ? formatAnswer(question.answer) : '',
    )
    setAnswerMessage('')
  }, [question?.index, index])
  const deck = decks.find((item) => item.id === deckId)
  const visibleDecks = decks.filter((item) =>
    `${item.lessonName} ${item.title}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  const visibleQuestions = questions.filter(
    (item) => !onlyUnanswered || !item.answer,
  )

  return (
    <section className="panel question-bank">
      <div className="panel-heading">
        <div>
          <h2>题目与答案</h2>
          <p>
            查看本地课件题目，答案每 5
            秒刷新。数字答案保留原始序号，请结合题图核对。
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          刷新题库
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="question-toolbar">
        <input
          aria-label="搜索课程或课件"
          placeholder="搜索课程或课件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="选择课件"
          value={deckId}
          onChange={(event) => setDeckId(event.target.value)}
        >
          <option value="">选择课件（{visibleDecks.length}）</option>
          {visibleDecks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.lessonName} · {item.title}
            </option>
          ))}
        </select>
      </div>
      {loading && <p role="status">正在读取题库…</p>}
      {!loading && !decks.length && (
        <div className="question-empty">
          暂无本地题目。下载含题目的课件后会出现在这里；已有 AI
          答案缓存也会自动载入。
        </div>
      )}
      {deck && (
        <>
          <div className="question-summary">
            <strong>{deck.title}</strong>
            <span>
              {deck.lessonName} · 共 {questions.length} 题，已有答案{' '}
              {questions.filter((item) => item.answer).length} 题
            </span>
          </div>
          <div className="question-layout">
            <aside className="question-list">
              <label className="question-filter">
                <input
                  type="checkbox"
                  checked={onlyUnanswered}
                  onChange={(event) => setOnlyUnanswered(event.target.checked)}
                />
                只看暂无答案
              </label>
              {visibleQuestions.map((item) => (
                <button
                  key={item.index}
                  className={`question-tab ${index === item.index ? 'selected' : ''}`}
                  onClick={() => setIndex(item.index)}
                >
                  <strong>第 {item.index} 页</strong>
                  <span>{statusLabels[item.status]}</span>
                </button>
              ))}
              {!visibleQuestions.length && <p>没有匹配的题目</p>}
            </aside>
            {question && (
              <article
                className="question-detail"
                aria-label={`第 ${question.index} 页题目`}
              >
                <h3>
                  第 {question.index} 页{' '}
                  <span className="question-status">
                    {statusLabels[question.status]}
                  </span>
                </h3>
                {imageLoading ? (
                  <p role="status">正在读取题图…</p>
                ) : image ? (
                  <img
                    className="question-image"
                    src={image}
                    alt={`第 ${question.index} 页题目图片`}
                  />
                ) : (
                  <div className="question-empty">
                    本地题图不可用，请重新下载课件。
                  </div>
                )}
                {question.text && (
                  <p className="question-text">{question.text}</p>
                )}
                <div className="question-answers">
                  <div>
                    <span>AI 分析答案</span>
                    <strong>{formatAnswer(question.aiAnswer)}</strong>
                  </div>
                  <div>
                    <span>
                      当前采用答案
                      {question.source === 'manual'
                        ? '（人工优先）'
                        : question.source === 'ai'
                          ? '（AI）'
                          : ''}
                    </span>
                    <strong>{formatAnswer(question.answer)}</strong>
                  </div>
                </div>
                <p className="question-answer-time">
                  回答状态：{question.answer ? '已回答' : '未回答'} · 回答时间：
                  {question.answeredAt
                    ? new Date(question.answeredAt).toLocaleString()
                    : question.answer
                      ? '旧记录未保存时间'
                      : '—'}
                </p>
                <p className="question-record-note">
                  此处记录 AI / 人工答案生成情况，课堂提交结果请查看运行日志。
                </p>
                <details className="question-history">
                  <summary>原始响应记录（{question.aiHistory.length}）</summary>
                  {question.aiHistory.length ? (
                    <AiHistory tasks={question.aiHistory} />
                  ) : (
                    <p>暂无原始响应记录；旧缓存未保存原始响应。</p>
                  )}
                </details>
                <form
                  className="manual-answer-editor"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!window.desktop || savingAnswer) return
                    setSavingAnswer(true)
                    setAnswerMessage('')
                    void window.desktop
                      .saveManualAnswer(deckId, question.index, manualDraft)
                      .then((data) => {
                        setQuestions(data)
                        setAnswerMessage(
                          manualDraft.trim()
                            ? '人工答案已保存'
                            : '已恢复采用 AI 答案',
                        )
                      })
                      .catch(() => setAnswerMessage('保存失败，请重试'))
                      .finally(() => setSavingAnswer(false))
                  }}
                >
                  <label htmlFor="manual-answer">手动编辑答案</label>
                  <div className="manual-answer-controls">
                    <input
                      id="manual-answer"
                      value={manualDraft}
                      onChange={(event) => setManualDraft(event.target.value)}
                      placeholder="输入答案；留空后保存可恢复 AI 答案"
                    />
                    <button
                      className="button secondary"
                      disabled={savingAnswer}
                    >
                      {savingAnswer ? '保存中…' : '保存答案'}
                    </button>
                  </div>
                  {answerMessage && <span role="status">{answerMessage}</span>}
                </form>
              </article>
            )}
          </div>
        </>
      )}
    </section>
  )
}
