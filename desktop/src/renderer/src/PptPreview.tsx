import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Images,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { DownloadedPresentation } from '../../shared/contract'
import './ppt-preview.css'

const deckKey = (deck: DownloadedPresentation) =>
  JSON.stringify([deck.course, deck.title])

export function PptPreview() {
  const [decks, setDecks] = useState<DownloadedPresentation[]>([])
  const [selected, setSelected] = useState('')
  const [pageName, setPageName] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [image, setImage] = useState<{
    key: string
    src?: string
    error?: string
  }>()
  const filtered = useMemo(
    () =>
      decks.filter((deck) =>
        `${deck.course} ${deck.title}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [decks, query],
  )
  const deck =
    filtered.find((item) => deckKey(item) === selected) ?? filtered[0]
  const page =
    deck?.slides.find((slide) => slide.name === pageName) ?? deck?.slides[0]
  const index =
    deck?.slides.findIndex((slide) => slide.name === page?.name) ?? -1
  const imageKey =
    deck && page
      ? JSON.stringify([
          deck.course,
          deck.title,
          page.name,
          page.modified,
          revision,
        ])
      : ''

  useEffect(() => {
    let active = true
    if (!window.desktop) {
      setBusy(false)
      return
    }
    setBusy(true)
    setError('')
    void window.desktop
      .getDownloadedPresentations()
      .then((items) => {
        if (active) setDecks(items)
      })
      .catch(() => {
        if (active) setError('无法读取已下载课件，请刷新重试。')
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [revision])

  useEffect(() => {
    if (!deck || !page || !window.desktop) return
    let active = true
    setImage({ key: imageKey })
    void window.desktop
      .getPptImage(deck.course, deck.title, page.name)
      .then((src) => {
        if (active) setImage({ key: imageKey, src })
      })
      .catch(() => {
        if (active)
          setImage({
            key: imageKey,
            error: '图片无法读取，可能尚未下载完成或已被移除。请刷新重试。',
          })
      })
    return () => {
      active = false
    }
  }, [imageKey])

  const openFolder = () => {
    void window.desktop
      ?.openPptFolder(deck?.course, deck?.title)
      .catch(() => setError('无法打开图片目录，请重试。'))
  }
  const changePage = (offset: number) => {
    const next = deck?.slides[index + offset]
    if (next) {
      setPageName(next.name)
      setZoom(false)
    }
  }

  return (
    <section className="ppt-library" aria-label="已下载 PPT">
      <div className="ppt-library-toolbar">
        <label className="ppt-search">
          <Search size={17} />
          <input
            aria-label="搜索课件"
            placeholder="搜索课程或 PPT 名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy || !window.desktop}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
          {busy ? '正在读取' : '刷新课件'}
        </button>
        <button
          className="button"
          disabled={!window.desktop}
          onClick={openFolder}
        >
          <FolderOpen size={16} />
          打开图片目录
        </button>
      </div>
      {error && (
        <div className="ppt-error" role="alert">
          {error}
        </div>
      )}
      {!window.desktop ? (
        <div className="panel ppt-empty">
          <Images size={36} />
          <h2>请在桌面应用中预览课件</h2>
          <p>这里会显示应用已下载的 PPT 图片。</p>
        </div>
      ) : !decks.length ? (
        <div className="panel ppt-empty">
          <Images size={36} />
          <h2>{busy ? '正在读取课件…' : '暂无已下载的 PPT 图片'}</h2>
          <p>
            启动课堂监听后，收到的课件图片会保存到这里。下载后点击“刷新课件”查看。
          </p>
        </div>
      ) : !deck ? (
        <div className="panel ppt-empty">
          <Search size={36} />
          <h2>没有匹配的课件</h2>
          <p>试试其他课程或 PPT 名称。</p>
        </div>
      ) : (
        <div className="ppt-layout">
          <aside className="panel ppt-decks" aria-label="课件列表">
            <div className="ppt-list-heading">
              已下载课件 <span>{filtered.length}</span>
            </div>
            {filtered.map((item) => (
              <button
                key={deckKey(item)}
                className={`ppt-deck ${deckKey(deck) === deckKey(item) ? 'selected' : ''}`}
                aria-pressed={deckKey(deck) === deckKey(item)}
                onClick={() => {
                  setSelected(deckKey(item))
                  setPageName('')
                  setZoom(false)
                }}
              >
                <span className="ppt-course">{item.course}</span>
                <strong>{item.title}</strong>
                <span>
                  {item.slides.length} 张图片 ·{' '}
                  {new Date(item.modified).toLocaleDateString('zh-CN')}
                </span>
              </button>
            ))}
          </aside>
          <div className="panel ppt-viewer">
            <div className="ppt-viewer-heading">
              <div>
                <span className="ppt-course">{deck.course}</span>
                <h2>{deck.title}</h2>
              </div>
              <button
                className="button"
                onClick={() => setZoom(!zoom)}
                disabled={!image?.src}
              >
                {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                {zoom ? '适应窗口' : '放大查看'}
              </button>
            </div>
            <div
              className={`ppt-stage ${zoom ? 'zoomed' : ''}`}
              aria-live="polite"
            >
              {image?.key === imageKey && image.error ? (
                <p role="alert">{image.error}</p>
              ) : image?.key === imageKey && image.src ? (
                <img
                  src={image.src}
                  alt={`${deck.title} 第 ${page?.name.replace(/\.[^.]+$/, '')} 页`}
                  onError={() =>
                    setImage({
                      key: imageKey,
                      error: '图片已损坏或无法显示，请刷新重试。',
                    })
                  }
                />
              ) : (
                <p>正在加载图片…</p>
              )}
            </div>
            <div
              className="ppt-pagination"
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  changePage(event.key === 'ArrowLeft' ? -1 : 1)
                }
              }}
            >
              <button
                className="button"
                disabled={index <= 0}
                onClick={() => changePage(-1)}
              >
                <ChevronLeft size={16} />
                上一页
              </button>
              <span>
                第 {index + 1} / {deck.slides.length} 张
              </span>
              <button
                className="button"
                disabled={index >= deck.slides.length - 1}
                onClick={() => changePage(1)}
              >
                下一页
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="ppt-pages" aria-label="选择 PPT 页码">
              {deck.slides.map((slide, position) => (
                <button
                  key={slide.name}
                  title={slide.name}
                  aria-label={`第 ${slide.name.replace(/\.[^.]+$/, '')} 页`}
                  aria-current={position === index ? 'page' : undefined}
                  className={position === index ? 'selected' : ''}
                  onClick={() => {
                    setPageName(slide.name)
                    setZoom(false)
                  }}
                >
                  {slide.name.replace(/\.[^.]+$/, '')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
