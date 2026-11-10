import { PptPreview } from './PptPreview'
import { HelpTip } from './HelpTip'
import { AiServiceTest } from './AiServiceTest'
import { QuestionBank } from './QuestionBank'
import { AiTasks } from './AiTasks'
import { useAutoSaveConfig } from './useAutoSaveConfig'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  WifiOff,
  X,
  CircleAlert,
} from 'lucide-react'
import type {
  AssistantConfig,
  Course,
  EmailConfig,
  LogEntry,
  LoginUpdate,
  RuntimeState,
  UpdateState,
} from '../../shared/contract'

type View = 'overview' | 'logs' | 'settings' | 'ppt' | 'questions' | 'ai-tasks'

export default function App() {
  const [view, setView] = useState<View>('overview')
  const [runtime, setRuntime] = useState<RuntimeState | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [query, setQuery] = useState('')
  const [logLevel, setLogLevel] = useState('all')
  const [helpOpen, setHelpOpen] = useState(false)
  const [startupSupported, setStartupSupported] = useState(false)
  const [controlError, setControlError] = useState('')
  const {
    config,
    loadConfig,
    updateConfig,
    saveState,
    toast,
    dismissToast,
    retrySave,
  } = useAutoSaveConfig(isConfigValid)
  const [emailTestState, setEmailTestState] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle')
  const [emailPasswordDraft, setEmailPasswordDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [sessionDraft, setSessionDraft] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [controlBusy, setControlBusy] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginUpdate, setLoginUpdate] = useState<LoginUpdate>({
    status: 'closed',
    message: '选择平台后获取二维码',
  })
  const [update, setUpdate] = useState<UpdateState>({ status: 'checking' })

  useEffect(() => {
    if (!window.desktop) {
      setRuntime({
        connected: false,
        listening: false,
        courses: 0,
        lastUpdated: null,
        userName: null,
        error: null,
      })
      setLogs([])
      return
    }
    void window.desktop.getRuntimeState().then(setRuntime)
    void window.desktop.getCourses().then(setCourses)
    void window.desktop.getLogs().then(setLogs)
    void window.desktop.getConfig().then(loadConfig)
    void window.desktop.supportsOpenAtLogin().then(setStartupSupported)
    void window.desktop.getUpdateState().then(setUpdate)
    const offRuntime = window.desktop.onRuntimeState((state) => {
      setRuntime(state)
      void window.desktop?.getCourses().then(setCourses)
    })
    const offLog = window.desktop.onLog((entry) =>
      setLogs((current) => [...current, entry].slice(-500)),
    )
    const offLogin = window.desktop.onLoginUpdate(setLoginUpdate)
    const offUpdate = window.desktop.onUpdateState(setUpdate)
    return () => {
      offRuntime()
      offLog()
      offLogin()
      offUpdate()
    }
  }, [loadConfig])

  useEffect(() => {
    if (loginUpdate.status !== 'success' || !window.desktop) return
    void window.desktop.getConfig().then(loadConfig)
  }, [loginUpdate.status, loadConfig])

  const filteredLogs = useMemo(
    () =>
      logs
        .filter(
          (entry) =>
            (logLevel === 'all' || entry.level === logLevel) &&
            `${entry.source} ${entry.message} ${entry.level}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .reverse(),
    [logs, query, logLevel],
  )
  const todayPrefix = new Date().toLocaleDateString('zh-CN')
  const todayEventCount = logs.filter((entry) =>
    entry.time.startsWith(todayPrefix),
  ).length
  const latestLog = logs.at(-1)

  const controlMonitoring = async (start: boolean) => {
    if (!window.desktop) return
    setControlBusy(true)
    setControlError('')
    try {
      setRuntime(
        await (start
          ? window.desktop.startMonitoring()
          : window.desktop.stopMonitoring()),
      )
    } catch (error) {
      setControlError(
        error instanceof Error ? error.message : '操作失败，请查看运行日志',
      )
    } finally {
      setControlBusy(false)
    }
  }

  const beginLogin = () => {
    if (!window.desktop || !config) return
    setLoginUpdate({ status: 'connecting', message: '正在连接登录服务' })
    void window.desktop.beginLogin(Number(config.region)).catch((error) =>
      setLoginUpdate({
        status: 'error',
        message: error instanceof Error ? error.message : '登录连接失败',
      }),
    )
  }

  const updateEmail = (patch: Partial<EmailConfig>) => {
    if (!config) return
    updateConfig({
      ...config,
      email_config: { ...config.email_config, ...patch },
    })
    setEmailTestState('idle')
  }

  const updateAnswerDelay = (
    patch: Partial<AssistantConfig['answer_config']['answer_delay']>,
  ) => {
    if (!config) return
    updateConfig({
      ...config,
      answer_config: {
        ...config.answer_config,
        answer_delay: { ...config.answer_config.answer_delay, ...patch },
      },
    })
  }

  const updateSignDelay = (
    patch: Partial<AssistantConfig['sign_config']['delay_time']>,
  ) => {
    if (!config) return
    updateConfig({
      ...config,
      sign_config: {
        ...config.sign_config,
        delay_time: { ...config.sign_config.delay_time, ...patch },
      },
    })
  }

  const updateAudioType = (
    key: keyof AssistantConfig['audio_config']['audio_type'],
    checked: boolean,
  ) => {
    if (!config) return
    updateConfig({
      ...config,
      audio_config: {
        ...config.audio_config,
        audio_type: { ...config.audio_config.audio_type, [key]: checked },
      },
    })
  }

  return (
    <div className={`app-shell ${view === 'ppt' ? 'ppt-workspace' : ''}`}>
      {toast && (
        <div
          className={`save-toast ${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={20} />
          ) : (
            <CircleAlert size={20} />
          )}
          <span>{toast.message}</span>
          {saveState === 'error' && (
            <button className="button" onClick={retrySave}>
              重试
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭保存提示"
            onClick={dismissToast}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={20} />
          </div>
          <div>
            <strong>摸鱼课堂</strong>
            <span>CLASSROOM ASSISTANT</span>
          </div>
        </div>

        <div className="workspace-label">工作台</div>
        <nav className="nav-list" aria-label="主导航">
          <button
            className={`nav-item ${view === 'ai-tasks' ? 'selected' : ''}`}
            onClick={() => setView('ai-tasks')}
          >
            <Activity size={18} /> AI 任务
          </button>
          <button
            className={`nav-item ${view === 'questions' ? 'selected' : ''}`}
            onClick={() => setView('questions')}
          >
            <BookOpen size={17} /> <span>题库与答案</span>
          </button>
          <button
            className={`nav-item ${view === 'overview' ? 'selected' : ''}`}
            onClick={() => setView('overview')}
          >
            <LayoutDashboard size={17} /> <span>运行概览</span>
          </button>
          <button
            className={`nav-item ${view === 'logs' ? 'selected' : ''}`}
            onClick={() => setView('logs')}
          >
            <FileText size={17} /> <span>运行日志</span>
            <span className="nav-count">{logs.length}</span>
          </button>
          <button
            className={`nav-item ${view === 'ppt' ? 'selected' : ''}`}
            onClick={() => setView('ppt')}
          >
            <BookOpen size={17} /> <span>PPT 预览</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="runtime-card">
          <div className="runtime-card-heading">
            <span className="status-dot muted" /> 桌面服务
          </div>
          <div className="runtime-card-copy">
            {runtime?.connected ? '账号已连接' : '等待扫码登录'}
          </div>
          <div className="runtime-progress">
            <i style={{ width: runtime?.listening ? '100%' : '0%' }} />
          </div>
          <div className="runtime-foot">
            <span>{runtime?.listening ? '正在监听' : '尚未启动监听'}</span>
            <span>{__APP_VERSION__}</span>
          </div>
        </div>
        <button className="profile-row" onClick={() => setView('settings')}>
          <div className="avatar">RA</div>
          <span className="profile-name">
            {runtime?.userName || '账号与设置'}
          </span>
          <ChevronDown size={15} />
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>摸鱼课堂</span>
            <span className="crumb-sep">/</span>
            <strong>
              {view === 'ai-tasks'
                ? 'AI 任务'
                : view === 'overview'
                  ? '运行概览'
                  : view === 'logs'
                    ? '运行日志'
                    : view === 'ppt'
                      ? 'PPT 预览'
                      : view === 'questions'
                        ? '题库与答案'
                        : '设置'}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="button"
              disabled={
                !window.desktop ||
                ['checking', 'available', 'downloading', 'downloaded'].includes(
                  update.status,
                )
              }
              title={update.message || '检查软件更新'}
              onClick={() =>
                void window.desktop
                  ?.checkForUpdates()
                  .then(setUpdate)
                  .catch(() => setControlError('无法检查更新，请稍后重试'))
              }
            >
              {update.status === 'checking' ? '正在检查更新' : '检查更新'}
            </button>
            {(update.message || update.status === 'error') && (
              <button
                className="button"
                title={update.message}
                onClick={() => void window.desktop?.openReleasePage()}
              >
                {update.version && update.status === 'not-available'
                  ? `已是最新 ${update.version}`
                  : '版本下载'}
              </button>
            )}
            {update.status === 'available' && (
              <span className="connection">发现新版本 {update.version}</span>
            )}
            {update.status === 'downloading' && (
              <span className="connection">正在下载更新 {update.percent}%</span>
            )}
            {update.status === 'downloaded' && (
              <button
                className="button primary"
                onClick={() =>
                  void window.desktop
                    ?.installUpdate()
                    .catch(() =>
                      setControlError('无法安装更新，请查看日志或从发布页下载'),
                    )
                }
              >
                重启并安装 {update.version}
              </button>
            )}
            <span className="connection">
              {runtime?.connected ? (
                <Activity size={14} />
              ) : (
                <WifiOff size={14} />
              )}
              {runtime?.connected ? '账号已连接' : '账号未连接'}
            </span>
            <button
              className="icon-button"
              title="帮助"
              aria-label="帮助"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={17} />
            </button>
            <button
              className="icon-button"
              title="设置"
              aria-label="设置"
              onClick={() => setView('settings')}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> 桌面控制台
              </div>
              <h1>
                {view === 'ai-tasks'
                  ? 'AI 任务'
                  : view === 'overview'
                    ? '运行概览'
                    : view === 'logs'
                      ? '运行日志'
                      : view === 'questions'
                        ? '题库与答案'
                        : view === 'ppt'
                          ? 'PPT 预览'
                          : '设置'}
              </h1>
              <p>
                {view === 'ai-tasks'
                  ? '查看 AI 请求进度与历史响应记录。'
                  : view === 'overview'
                    ? '查看监听状态、课堂活动与最近运行事件。'
                    : view === 'logs'
                      ? '集中查看应用事件与诊断信息。'
                      : view === 'questions'
                        ? '逐题查看课件原图与当前答案。'
                        : view === 'ppt'
                          ? '浏览已下载的课件图片，按页查看课堂内容。'
                          : '管理课堂自动化与 AI 分析参数。'}
              </p>
            </div>
            <div className="heading-actions">
              {view === 'settings' ? (
                <button
                  className="button secondary"
                  onClick={() => setView('overview')}
                >
                  返回概览
                </button>
              ) : (
                <button
                  className="button secondary"
                  disabled={!window.desktop}
                  onClick={() => void window.desktop?.openLogFolder()}
                >
                  <FolderOpen size={16} /> 打开日志目录
                </button>
              )}
              {!runtime?.connected && (
                <button
                  className="button secondary"
                  onClick={() => setLoginOpen(true)}
                >
                  扫码登录
                </button>
              )}
              <button
                className="button primary"
                disabled={
                  !window.desktop ||
                  controlBusy ||
                  runtime?.listening ||
                  !runtime?.connected
                }
                onClick={() => void controlMonitoring(true)}
              >
                <Play size={15} fill="currentColor" /> 启动监听
              </button>
            </div>
          </div>

          <div className="migration-banner">
            <div className="migration-icon">
              <Activity size={18} />
            </div>
            <div className="migration-copy">
              <strong>
                {controlError ? '操作未完成' : '课堂监听与自动化'}
              </strong>
              <span>
                {controlError ||
                  (update.status === 'error'
                    ? update.message
                    : '账号连接后，实时课程、课堂事件与自动化状态会显示在这里。')}
              </span>
            </div>
            <span className="migration-tag">
              <span
                className={`status-dot ${runtime?.connected ? '' : 'muted'}`}
              />{' '}
              {runtime?.connected ? '账号已连接' : '等待登录'}
            </span>
          </div>

          {view === 'ai-tasks' ? (
            <AiTasks />
          ) : view === 'questions' ? (
            <QuestionBank />
          ) : view === 'ppt' ? (
            <PptPreview />
          ) : view === 'settings' ? (
            <section className="settings-layout">
              {!config ? (
                <div className="panel settings-unavailable">
                  <div className="empty-icon">
                    <Settings2 size={20} />
                  </div>
                  <strong>
                    {window.desktop ? '正在读取设置…' : '设置需要桌面运行服务'}
                  </strong>
                  <span>
                    {window.desktop
                      ? '配置保存在本机用户数据目录。'
                      : '浏览器预览无法访问本地配置文件。'}
                  </span>
                </div>
              ) : (
                <>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>启动设置</h2>
                        <p>控制应用启动及课堂监听行为</p>
                      </div>
                      <Settings2 size={16} />
                    </div>
                    <SettingToggle
                      label="开机自启"
                      description={
                        startupSupported
                          ? '登录 Windows 后自动启动应用；便携版请保持程序位置不变'
                          : '开机自启仅支持打包后的 Windows 程序，开发和测试模式不可用'
                      }
                      checked={config.open_at_login}
                      disabled={!startupSupported}
                      onChange={(checked) =>
                        updateConfig({ ...config, open_at_login: checked })
                      }
                    />
                    <SettingToggle
                      label="启动时自动开始监听"
                      description="下次启动应用时自动验证登录并开始监听；未登录或会话失效时请先扫码登录，再手动开始监听"
                      checked={config.auto_start_monitoring}
                      onChange={(checked) =>
                        updateConfig({
                          ...config,
                          auto_start_monitoring: checked,
                        })
                      }
                    />
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>账号与平台</h2>
                        <p>
                          {runtime?.userName
                            ? `当前账号：${runtime.userName}`
                            : '使用微信扫码登录'}
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setLoginOpen(true)}
                      >
                        扫码登录
                      </button>
                    </div>
                    <label className="field-row">
                      <span>雨课堂平台</span>
                      <select
                        value={String(config.region)}
                        onChange={(event) =>
                          updateConfig({
                            ...config,
                            region: Number(event.target.value),
                          })
                        }
                      >
                        <option value="0">雨课堂</option>
                        <option value="1">荷塘雨课堂</option>
                        <option value="2">长江雨课堂</option>
                        <option value="3">黄河雨课堂</option>
                      </select>
                    </label>
                    <label className="field-row">
                      <span>
                        会话 sessionid
                        <HelpTip label="会话 sessionid">
                          扫码登录后自动保存，无需手动填写。仅在需要替换登录会话时填写；请勿分享给他人。
                        </HelpTip>
                      </span>
                      <input
                        aria-label="会话 sessionid"
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          config.sessionid
                            ? '已登录，输入新会话以替换'
                            : '扫码登录时自动填写'
                        }
                        value={sessionDraft}
                        onChange={(event) => {
                          setSessionDraft(event.target.value)
                          updateConfig({
                            ...config,
                            sessionid: event.target.value,
                          })
                        }}
                      />
                    </label>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>自动签到</h2>
                        <p>按课程开始时间和配置决定加入课堂监听的时机</p>
                      </div>
                      <Clock3 size={16} />
                    </div>
                    <label className="field-row">
                      <span>
                        签到延迟策略
                        <HelpTip label="签到延迟策略">
                          选择进入课堂前是否等待。随机延迟只在课程开始后的生效窗口内使用，超过窗口会立即加入。
                        </HelpTip>
                      </span>
                      <select
                        aria-label="签到延迟策略"
                        value={config.sign_config.delay_time.type}
                        onChange={(event) =>
                          updateSignDelay({ type: Number(event.target.value) })
                        }
                      >
                        <option value={1}>自定义随机延迟</option>
                        <option value={2}>不延时</option>
                      </select>
                    </label>
                    <div
                      className={`settings-fields ${config.sign_config.delay_time.type === 1 ? '' : 'disabled'}`}
                    >
                      <label className="field-row">
                        <span>
                          随机延迟上限（秒）
                          <HelpTip label="随机延迟上限（秒）">
                            在 10 秒与此上限之间随机等待后加入课堂；最小上限为
                            10 秒。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="随机延迟上限（秒）"
                          type="number"
                          min="10"
                          value={config.sign_config.delay_time.custom.time}
                          onChange={(event) =>
                            updateSignDelay({
                              custom: {
                                ...config.sign_config.delay_time.custom,
                                time: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          延迟生效窗口（秒）
                          <HelpTip label="延迟生效窗口（秒）">
                            从课程开始时计时。超过此窗口后发现课程，将直接加入，不再随机等待。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="延迟生效窗口（秒）"
                          type="number"
                          min="0"
                          value={config.sign_config.delay_time.custom.cutoff}
                          onChange={(event) =>
                            updateSignDelay({
                              custom: {
                                ...config.sign_config.delay_time.custom,
                                cutoff: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>自动答题</h2>
                        <p>选择题目提交前的等待策略</p>
                      </div>
                      <SlidersHorizontal size={16} />
                    </div>
                    <SettingToggle
                      label="启用自动答题"
                      description="收到课堂题目时使用课件答案或分析缓存"
                      checked={config.auto_answer}
                      onChange={(checked) => {
                        updateConfig({ ...config, auto_answer: checked })
                      }}
                    />
                    <div
                      className={`settings-fields ${config.auto_answer ? '' : 'disabled'}`}
                    >
                      <label className="field-row">
                        <span>
                          答题延迟策略
                          <HelpTip label="答题延迟策略">
                            激进通常更早提交，保守通常更晚提交，中庸使用默认等待策略。自定义按剩余作答时间的比例等待；所有策略都受题目截止时间限制。
                          </HelpTip>
                        </span>
                        <select
                          aria-label="答题延迟策略"
                          value={config.answer_config.answer_delay.type}
                          onChange={(event) =>
                            updateAnswerDelay({
                              type: Number(event.target.value),
                            })
                          }
                        >
                          <option value={1}>中庸</option>
                          <option value={2}>激进</option>
                          <option value={3}>保守</option>
                          <option value={4}>自定义</option>
                        </select>
                      </label>
                      <label className="field-row">
                        <span>
                          自定义延迟比例（%）
                          <HelpTip label="自定义延迟比例（%）">
                            仅在自定义策略下生效。例如填
                            50，会等待约一半剩余作答时间后提交；0 表示尽快提交。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="自定义延迟比例（%）"
                          type="number"
                          min="0"
                          max="100"
                          disabled={
                            config.answer_config.answer_delay.type !== 4
                          }
                          value={
                            config.answer_config.answer_delay.custom.percent
                          }
                          onChange={(event) =>
                            updateAnswerDelay({
                              custom: { percent: Number(event.target.value) },
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>自动弹幕</h2>
                        <p>统计最近一分钟内重复出现的内容</p>
                      </div>
                      <MessageSquare size={16} />
                    </div>
                    <SettingToggle
                      label="启用自动弹幕跟随"
                      description="达到阈值后发送相同内容，并对内容启用 60 秒冷却"
                      checked={config.auto_danmu}
                      onChange={(checked) => {
                        updateConfig({ ...config, auto_danmu: checked })
                      }}
                    />
                    <div
                      className={`settings-fields ${config.auto_danmu ? '' : 'disabled'}`}
                    >
                      <label className="field-row">
                        <span>
                          每分钟触发阈值（条）
                          <HelpTip label="每分钟触发阈值（条）">
                            滚动统计最近 60
                            秒的相同弹幕，达到此条数才跟随发送；同一内容发送后冷却
                            60 秒。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="每分钟触发阈值（条）"
                          type="number"
                          min="1"
                          value={config.danmu_config.danmu_limit}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              danmu_config: {
                                ...config.danmu_config,
                                danmu_limit: Number(event.target.value),
                              },
                            })
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>语音提醒</h2>
                        <p>按事件类型分别播放系统语音</p>
                      </div>
                      <Activity size={16} />
                    </div>
                    <SettingToggle
                      label="启用语音提醒"
                      description="使用系统语音播报选中的课堂事件"
                      checked={config.audio_on}
                      onChange={(checked) => {
                        updateConfig({ ...config, audio_on: checked })
                      }}
                    />
                    <div
                      className={`settings-fields ${config.audio_on ? '' : 'disabled'}`}
                    >
                      <SettingToggle
                        label="自动发送弹幕"
                        description="跟随发送成功时播报"
                        checked={config.audio_config.audio_type.send_danmu}
                        onChange={(checked) =>
                          updateAudioType('send_danmu', checked)
                        }
                      />
                      <SettingToggle
                        label="他人发送弹幕"
                        description="收到同学弹幕时播报"
                        checked={config.audio_config.audio_type.others_danmu}
                        onChange={(checked) =>
                          updateAudioType('others_danmu', checked)
                        }
                      />
                      <SettingToggle
                        label="收到题目"
                        description="自动答题关闭时提示待处理题目"
                        checked={config.audio_config.audio_type.receive_problem}
                        onChange={(checked) =>
                          updateAudioType('receive_problem', checked)
                        }
                      />
                      <SettingToggle
                        label="自动答题情况"
                        description="提交成功、失败或未找到答案时播报"
                        checked={config.audio_config.audio_type.answer_result}
                        onChange={(checked) =>
                          updateAudioType('answer_result', checked)
                        }
                      />
                      <SettingToggle
                        label="自己被点名"
                        description="点名姓名与当前账号一致时播报"
                        checked={config.audio_config.audio_type.im_called}
                        onChange={(checked) =>
                          updateAudioType('im_called', checked)
                        }
                      />
                      <SettingToggle
                        label="他人被点名"
                        description="课堂点到其他同学时播报"
                        checked={config.audio_config.audio_type.others_called}
                        onChange={(checked) =>
                          updateAudioType('others_called', checked)
                        }
                      />
                      <SettingToggle
                        label="课程信息"
                        description="连接、课件变更或下课时播报"
                        checked={config.audio_config.audio_type.course_info}
                        onChange={(checked) =>
                          updateAudioType('course_info', checked)
                        }
                      />
                      <SettingToggle
                        label="网络信息"
                        description="课堂 WebSocket 连接错误时播报"
                        checked={config.audio_config.audio_type.network_info}
                        onChange={(checked) =>
                          updateAudioType('network_info', checked)
                        }
                      />
                    </div>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>邮件通知</h2>
                        <p>自动答题结果或未找到答案时发送</p>
                      </div>
                      <Activity size={16} />
                    </div>
                    <SettingToggle
                      label="启用邮件通知"
                      description="发送自动答题成功、失败和待人工处理提醒"
                      checked={config.email_config.enabled}
                      onChange={(enabled) => updateEmail({ enabled })}
                    />
                    <div
                      className={`settings-fields ${config.email_config.enabled ? '' : 'disabled'}`}
                    >
                      <label className="field-row">
                        <span>SMTP 服务器</span>
                        <input
                          value={config.email_config.smtp_server}
                          onChange={(event) =>
                            updateEmail({ smtp_server: event.target.value })
                          }
                          placeholder="smtp.example.com"
                        />
                      </label>
                      <label className="field-row">
                        <span>SMTP 端口</span>
                        <input
                          type="number"
                          min="1"
                          max="65535"
                          value={config.email_config.smtp_port}
                          onChange={(event) =>
                            updateEmail({
                              smtp_port: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field-row">
                        <span>登录账号</span>
                        <input
                          autoComplete="username"
                          value={config.email_config.username}
                          onChange={(event) =>
                            updateEmail({ username: event.target.value })
                          }
                        />
                      </label>
                      <label className="field-row">
                        <span>密码 / 授权码</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            config.email_config.password
                              ? '已配置，输入新密码以替换'
                              : '输入邮箱授权码'
                          }
                          value={emailPasswordDraft}
                          onChange={(event) => {
                            setEmailPasswordDraft(event.target.value)
                            updateEmail({ password: event.target.value })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>发件地址</span>
                        <input
                          value={config.email_config.sender}
                          onChange={(event) =>
                            updateEmail({ sender: event.target.value })
                          }
                          placeholder="留空则使用登录账号"
                        />
                      </label>
                      <label className="field-row">
                        <span>收件地址</span>
                        <input
                          type="email"
                          value={config.email_config.recipient}
                          onChange={(event) =>
                            updateEmail({ recipient: event.target.value })
                          }
                        />
                      </label>
                      <label className="field-row">
                        <span>邮件主题</span>
                        <input
                          value={config.email_config.subject}
                          onChange={(event) =>
                            updateEmail({ subject: event.target.value })
                          }
                        />
                      </label>
                      <SettingToggle
                        label="使用 SSL 直连"
                        description="通常端口 465 使用此模式"
                        checked={config.email_config.use_ssl}
                        onChange={(use_ssl) => updateEmail({ use_ssl })}
                      />
                      <SettingToggle
                        label="连接后启用 STARTTLS"
                        description="仅在未使用 SSL 直连时生效"
                        checked={config.email_config.starttls}
                        disabled={config.email_config.use_ssl}
                        onChange={(starttls) => updateEmail({ starttls })}
                      />
                      <label className="field-row">
                        <span>连接超时（秒）</span>
                        <input
                          type="number"
                          min="1"
                          value={config.email_config.timeout}
                          onChange={(event) =>
                            updateEmail({ timeout: Number(event.target.value) })
                          }
                        />
                      </label>
                    </div>
                    <div className="email-test-row">
                      <span className="save-status">
                        {emailTestState === 'sending'
                          ? '正在发送测试邮件…'
                          : emailTestState === 'sent'
                            ? '测试邮件发送成功'
                            : emailTestState === 'error'
                              ? '发送失败，请检查配置和授权码'
                              : ''}
                      </span>
                      <button
                        className="button secondary"
                        disabled={
                          !window.desktop ||
                          !config.email_config.enabled ||
                          emailTestState === 'sending'
                        }
                        onClick={() => {
                          if (!window.desktop) return
                          setEmailTestState('sending')
                          void window.desktop
                            .testEmail(config)
                            .then((sent) =>
                              setEmailTestState(sent ? 'sent' : 'error'),
                            )
                            .catch(() => setEmailTestState('error'))
                        }}
                      >
                        测试邮件
                      </button>
                    </div>
                  </div>
                  <div className="panel settings-section">
                    <div className="panel-heading">
                      <div>
                        <h2>AI 分析</h2>
                        <p>图像分析接口及请求生成参数</p>
                      </div>
                      <Activity size={16} />
                    </div>
                    <AiServiceTest config={config} />
                    <SettingToggle
                      label="启用 AI 分析"
                      description="课件下载后使用视觉模型分析题目"
                      checked={config.enable_ai_analysis}
                      onChange={(checked) => {
                        updateConfig({ ...config, enable_ai_analysis: checked })
                      }}
                    />
                    <div
                      className={`settings-fields ${config.enable_ai_analysis ? '' : 'disabled'}`}
                    >
                      <label className="field-row">
                        <span>
                          API 地址
                          <HelpTip label="API 地址">
                            填写模型服务的 API 基础地址。应用按所选协议拼接
                            responses 或 chat/completions
                            路径；需要支持图片输入的模型。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="API 地址"
                          value={config.openai_api_base}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              openai_api_base: event.target.value,
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>模型名称</span>
                        <input
                          value={config.openai_model}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              openai_model: event.target.value,
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>API 密钥</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            config.openai_api_key
                              ? '已配置，输入新密钥以替换'
                              : '输入 API 密钥'
                          }
                          value={apiKeyDraft}
                          onChange={(event) => {
                            setApiKeyDraft(event.target.value)
                            updateConfig({
                              ...config,
                              openai_api_key: event.target.value,
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          接口协议
                          <HelpTip label="接口协议">
                            选择服务商支持的协议。Responses
                            可使用推理强度与摘要参数；Chat Completions
                            使用聊天接口。两者都需要模型支持图片输入。
                          </HelpTip>
                        </span>
                        <select
                          aria-label="接口协议"
                          value={config.ai_analysis_settings.protocol}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                protocol: event.target
                                  .value as typeof config.ai_analysis_settings.protocol,
                              },
                            })
                          }}
                        >
                          <option value="responses">Responses</option>
                          <option value="chat_completions">
                            Chat Completions
                          </option>
                        </select>
                      </label>
                      <SettingToggle
                        label="流式响应"
                        description="逐事件接收并校验生成结果"
                        checked={config.ai_analysis_settings.stream}
                        onChange={(stream) => {
                          updateConfig({
                            ...config,
                            ai_analysis_settings: {
                              ...config.ai_analysis_settings,
                              stream,
                            },
                          })
                        }}
                      />
                      <label className="field-row">
                        <span>
                          推理强度
                          <HelpTip label="推理强度">
                            仅用于 Responses 协议。常见值有
                            low、medium、high，实际支持范围取决于所选模型；更高强度可能增加耗时和费用。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="推理强度"
                          disabled={
                            config.ai_analysis_settings.protocol !== 'responses'
                          }
                          value={config.ai_analysis_settings.reasoning_effort}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                reasoning_effort: event.target.value,
                              },
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          推理摘要
                          <HelpTip label="推理摘要">
                            仅用于 Responses
                            协议，请求模型返回可用的推理摘要。服务商和模型必须支持该参数；摘要不是完整的内部推理过程。
                          </HelpTip>
                        </span>
                        <select
                          aria-label="推理摘要"
                          disabled={
                            config.ai_analysis_settings.protocol !== 'responses'
                          }
                          value={
                            config.ai_analysis_settings.reasoning_summary ??
                            'null'
                          }
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                reasoning_summary:
                                  event.target.value === 'null'
                                    ? null
                                    : event.target.value,
                              },
                            })
                          }}
                        >
                          <option value="null">不请求摘要</option>
                          <option value="auto">自动</option>
                          <option value="concise">简短</option>
                          <option value="detailed">详细</option>
                        </select>
                      </label>
                      <label className="field-row">
                        <span>
                          输出 token 上限
                          <HelpTip label="输出 token 上限">
                            限制一次请求的输出 token 数，0
                            表示不主动设置上限。设置过低可能导致结果不完整；部分模型会把推理
                            token 计入此限制。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="输出 token 上限"
                          type="number"
                          min="0"
                          value={
                            config.ai_analysis_settings.max_output_tokens ?? 0
                          }
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                max_output_tokens: value === 0 ? null : value,
                              },
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          最大重试次数
                          <HelpTip label="最大重试次数">
                            请求失败后允许重试的次数，0
                            表示不重试。重试可能增加等待时间和 API 费用。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="最大重试次数"
                          type="number"
                          min="0"
                          value={config.ai_analysis_settings.max_retries}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                max_retries: Number(event.target.value),
                              },
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          请求超时（秒）
                          <HelpTip label="请求超时（秒）">
                            单次模型请求允许等待的最长时间。网络较慢或推理耗时较长时可适当增大。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="请求超时（秒）"
                          type="number"
                          min="0.001"
                          step="0.1"
                          value={config.ai_analysis_settings.request_timeout}
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                request_timeout: Number(event.target.value),
                              },
                            })
                          }}
                        />
                      </label>
                      <label className="field-row">
                        <span>
                          请求间隔（秒）
                          <HelpTip label="请求间隔（秒）">
                            批量分析课件时，两次请求之间的等待时间；适当增大可减少触发服务商限流的机会。
                          </HelpTip>
                        </span>
                        <input
                          aria-label="请求间隔（秒）"
                          type="number"
                          min="0"
                          step="0.1"
                          value={
                            config.ai_analysis_settings.delay_between_requests
                          }
                          onChange={(event) => {
                            updateConfig({
                              ...config,
                              ai_analysis_settings: {
                                ...config.ai_analysis_settings,
                                delay_between_requests: Number(
                                  event.target.value,
                                ),
                              },
                            })
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <span className="save-status">
                      {saveState === 'pending' || saveState === 'saving'
                        ? '正在自动保存…'
                        : saveState === 'error' || saveState === 'invalid'
                          ? '更改尚未保存，请修正配置或重试'
                          : '修改后自动保存，应用到后续课堂事件'}
                    </span>
                    {(saveState === 'error' || saveState === 'invalid') && (
                      <button className="button" onClick={retrySave}>
                        重试保存
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          ) : view === 'overview' ? (
            <>
              <section className="metric-grid" aria-label="运行指标">
                <Metric
                  icon={<Activity size={17} />}
                  label="监听状态"
                  value={runtime?.listening ? '运行中' : '未启动'}
                  detail={
                    runtime?.error ??
                    (runtime?.connected ? '运行服务已连接' : '等待登录')
                  }
                  tone="green"
                />
                <Metric
                  icon={<BookOpen size={17} />}
                  label="进行中课程"
                  value={String(runtime?.courses ?? '—')}
                  detail={
                    runtime?.lastUpdated
                      ? `更新于 ${new Date(runtime.lastUpdated).toLocaleTimeString()}`
                      : '暂无实时数据'
                  }
                  tone="blue"
                />
                <Metric
                  icon={<CheckCircle2 size={17} />}
                  label="今日事件"
                  value={String(todayEventCount)}
                  detail="按本地运行日志统计"
                  tone="orange"
                />
                <Metric
                  icon={<Clock3 size={17} />}
                  label="最近活动"
                  value={latestLog?.source ?? '—'}
                  detail={latestLog?.message ?? '等待首条运行事件'}
                  tone="slate"
                />
              </section>

              <section className="content-grid">
                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>课堂活动</h2>
                      <p>当前课程与执行中的任务</p>
                    </div>
                    <span className="connection">{courses.length} 门课程</span>
                  </div>
                  {courses.length ? (
                    <div className="course-list">
                      {courses.map((course) => (
                        <div className="course-row" key={course.lessonId}>
                          <span className="course-marker">
                            <BookOpen size={15} />
                          </span>
                          <span>
                            <strong>{course.courseName}</strong>
                            <small>
                              {course.title || '课程标题读取中'}
                              {course.teacher ? ` · ${course.teacher}` : ''}
                              {course.startTime
                                ? ` · ${new Date(course.startTime).toLocaleString()}`
                                : ''}
                            </small>
                          </span>
                          <span
                            className={`course-live ${course.status === 'waiting' ? 'waiting' : ''}`}
                          >
                            <i />
                            {course.status === 'connected'
                              ? '已连接'
                              : course.status === 'joining'
                                ? '加入中'
                                : '等待连接'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <BookOpen size={20} />
                      </div>
                      <strong>
                        {runtime?.listening
                          ? '当前没有进行中的课程'
                          : '尚无课堂活动'}
                      </strong>
                      <span>
                        {runtime?.error ??
                          '启动监听后，正在进行的课程会显示在这里。'}
                      </span>
                    </div>
                  )}
                  <div className="panel-footer">
                    <span>
                      <span
                        className={`status-dot ${runtime?.connected ? '' : 'muted'}`}
                      />{' '}
                      {runtime?.connected ? '运行服务在线' : '运行服务待连接'}
                    </span>
                    <span>
                      最近更新：
                      {runtime?.lastUpdated
                        ? new Date(runtime.lastUpdated).toLocaleTimeString()
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="panel quick-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>运行控制</h2>
                      <p>管理课堂监听任务</p>
                    </div>
                    <div className="control-icon">
                      <Command size={16} />
                    </div>
                  </div>
                  <div className="control-status">
                    <div className="control-status-icon">
                      {runtime?.connected ? (
                        <Activity size={18} />
                      ) : (
                        <WifiOff size={18} />
                      )}
                    </div>
                    <div>
                      <strong>
                        {runtime?.userName
                          ? `已登录：${runtime.userName}`
                          : (runtime?.error ?? '尚未登录')}
                      </strong>
                      <span>
                        {runtime?.listening ? '正在轮询课堂状态' : '准备就绪'}
                      </span>
                    </div>
                  </div>
                  <div className="control-buttons">
                    <button
                      className="button primary full"
                      disabled={
                        !window.desktop ||
                        controlBusy ||
                        runtime?.listening ||
                        !runtime?.connected
                      }
                      onClick={() => void controlMonitoring(true)}
                    >
                      <Play size={15} fill="currentColor" /> 启动监听
                    </button>
                    <button
                      className="button secondary full"
                      disabled={
                        !window.desktop || controlBusy || !runtime?.listening
                      }
                      onClick={() => void controlMonitoring(false)}
                    >
                      <Square size={14} /> 停止监听
                    </button>
                  </div>
                  <div className="secure-note">
                    <ShieldCheck size={14} />
                    <span>账号信息与配置沿用本地存储</span>
                  </div>
                </div>
              </section>

              <section className="panel log-panel">
                <div className="panel-heading">
                  <div>
                    <h2>最近日志</h2>
                    <p>应用运行与诊断事件</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView('logs')}
                  >
                    查看全部 <span>→</span>
                  </button>
                </div>
                {logs.length ? (
                  <div className="recent-log-list">
                    {logs
                      .slice(-3)
                      .reverse()
                      .map((entry) => (
                        <div className="recent-log-row" key={entry.id}>
                          <span
                            className={`level ${entry.level.toLowerCase()}`}
                          >
                            {entry.level}
                          </span>
                          <span className="recent-log-source">
                            {entry.source}
                          </span>
                          <span>{entry.message}</span>
                          <time>{entry.time}</time>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="log-empty">
                    <FileText size={17} />
                    <span>运行事件会实时显示在这里。</span>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="panel logs-view">
              <div className="panel-heading">
                <div>
                  <h2>事件记录</h2>
                  <p>最近 500 条日志，最新事件优先。完整记录保存在本机。</p>
                </div>
                <div className="log-tools">
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索日志"
                    />
                  </div>
                  <label className="log-level-filter">
                    <SlidersHorizontal size={16} />
                    <select
                      aria-label="日志级别"
                      value={logLevel}
                      onChange={(event) => setLogLevel(event.target.value)}
                    >
                      <option value="all">全部级别</option>
                      <option value="DEBUG">调试</option>
                      <option value="INFO">信息</option>
                      <option value="WARNING">警告</option>
                      <option value="ERROR">错误</option>
                    </select>
                  </label>
                </div>
              </div>
              {filteredLogs.length ? (
                <div className="log-table">
                  <div className="log-row log-header">
                    <span>时间</span>
                    <span>级别</span>
                    <span>来源</span>
                    <span>消息</span>
                  </div>
                  {filteredLogs.map((entry) => (
                    <div className="log-row" key={entry.id}>
                      <span>{entry.time}</span>
                      <span className={`level ${entry.level.toLowerCase()}`}>
                        {entry.level}
                      </span>
                      <span>{entry.source}</span>
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state logs-empty">
                  <div className="empty-icon">
                    <FileText size={20} />
                  </div>
                  <strong>{query ? '没有匹配的日志' : '暂无日志记录'}</strong>
                  <span>
                    {query
                      ? '试试其他关键词。'
                      : '连接运行服务后，应用事件会显示在这里。'}
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      {loginOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="login-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
          >
            <div className="login-dialog-head">
              <div>
                <h2 id="login-title">微信扫码登录</h2>
                <p>登录信息仅保存在本机</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => {
                  void window.desktop?.cancelLogin()
                  setLoginOpen(false)
                }}
              >
                ×
              </button>
            </div>
            <label className="field-row">
              <span>雨课堂平台</span>
              <select
                value={String(config?.region ?? 1)}
                onChange={(event) => {
                  void window.desktop?.cancelLogin()
                  setLoginUpdate({
                    status: 'closed',
                    message: '平台已切换，请重新获取二维码',
                  })
                  if (config)
                    updateConfig({
                      ...config,
                      region: Number(event.target.value),
                    })
                }}
              >
                <option value="0">雨课堂</option>
                <option value="1">荷塘雨课堂</option>
                <option value="2">长江雨课堂</option>
                <option value="3">黄河雨课堂</option>
              </select>
            </label>
            <div className="qr-frame">
              {loginUpdate.image ? (
                <img src={loginUpdate.image} alt="雨课堂登录二维码" />
              ) : (
                <div className="qr-placeholder">
                  <GraduationCap size={25} />
                  <span>{loginUpdate.message ?? '点击获取二维码'}</span>
                </div>
              )}
            </div>
            <div className="login-status">
              <span
                className={`status-dot ${loginUpdate.status === 'success' ? '' : 'muted'}`}
              />
              {loginUpdate.message}
            </div>
            <div className="login-dialog-actions">
              <button
                className="button secondary"
                disabled={
                  !window.desktop || loginUpdate.status === 'connecting'
                }
                onClick={beginLogin}
              >
                刷新二维码
              </button>
              <button
                className="button primary"
                disabled={
                  !window.desktop || loginUpdate.status === 'connecting'
                }
                onClick={beginLogin}
              >
                获取二维码
              </button>
            </div>
          </section>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop">
          <section
            className="login-dialog help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <div className="login-dialog-head">
              <h2 id="help-title">使用帮助</h2>
              <button
                className="icon-button"
                aria-label="关闭帮助"
                onClick={() => setHelpOpen(false)}
              >
                ×
              </button>
            </div>
            <ol>
              <li>选择学校使用的平台，使用微信扫码登录。</li>
              <li>在设置里调整自动答题、签到延迟与通知，然后保存。</li>
              <li>返回概览并启动监听，课程开始后会自动连接。</li>
              <li>AI 分析需要单独配置支持图片的模型和 API 密钥。</li>
              <li>遇到异常时查看运行日志，或打开日志目录检查完整记录。</li>
            </ol>
            <p>
              安装版支持自动更新。便携版请从项目发布页下载新版后替换程序。配置、课件和答案缓存保留在本机用户数据目录。
            </p>
            <button
              className="button primary"
              onClick={() => setHelpOpen(false)}
            >
              知道了
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone: string
}) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  )
}

function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={`setting-toggle ${disabled ? 'disabled' : ''}`}>
      <span>
        <strong>
          {label}
          <HelpTip label={label}>{description}</HelpTip>
        </strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function isConfigValid(config: AssistantConfig) {
  const email = config.email_config
  if (
    email.enabled &&
    ![email.smtp_server, email.username, email.password, email.recipient].every(
      (value) => value.trim(),
    )
  )
    return false
  if (
    email.enabled &&
    (!Number.isInteger(email.smtp_port) ||
      email.smtp_port < 1 ||
      email.smtp_port > 65535)
  )
    return false
  if (
    config.enable_ai_analysis &&
    ![config.openai_api_key, config.openai_api_base, config.openai_model].every(
      (value) => value.trim(),
    )
  )
    return false
  if (
    config.enable_ai_analysis &&
    config.ai_analysis_settings.protocol === 'responses' &&
    !config.ai_analysis_settings.reasoning_effort.trim()
  )
    return false
  return true
}
