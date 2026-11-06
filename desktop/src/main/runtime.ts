import type { AssistantConfig, Course, RuntimeState } from '../shared/contract'
import type { AppLogger } from './logger'
import WebSocket from 'ws'
import {
  calculateAnswerDelay,
  hasUsableAnswer,
  remainingAnswerTime,
  shouldRetrySubmission,
  submissionCandidates,
} from './answers.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveCachedAnswer } from './answer-cache.ts'
import {
  downloadPresentation,
  downloadSlideImage,
  safePathComponent,
  slideImagePath,
} from './presentation.ts'
import { AiAnalyzer } from './ai-analyzer.ts'
import { sendEmailNotificationIfNeeded } from './notifier.ts'
import { DanmuFollower } from './danmu.ts'
import { calculateJoinDelay } from './signing.ts'
import {
  collectProblemDisplayIndexes,
  normalizePresentationSlides,
} from './slides.ts'
import { isNetworkFailure } from './network.ts'

const hosts = [
  'www.yuketang.cn',
  'pro.yuketang.cn',
  'changjiang.yuketang.cn',
  'huanghe.yuketang.cn',
]
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'

export class ClassroomRuntime {
  private timer: NodeJS.Timeout | null = null
  private lifecycle = 0
  private state: RuntimeState = {
    connected: false,
    listening: false,
    courses: 0,
    lastUpdated: null,
    userName: null,
    error: null,
  }
  private courseList: Course[] = []
  private lessons = new Map<string, WebSocket>()
  private joiningLessons = new Set<string>()
  private userId = ''
  private problemAnswers = new Map<
    string,
    {
      id: string
      problemType: number
      answer: unknown
      result: unknown
      index: string
      title: string
      cover: string
      slides: Array<
        Record<string, unknown> & {
          index: string | number
          cover?: string
          problem?: Record<string, unknown>
        }
      >
    }
  >()
  private presentationLoads = new Map<string, Promise<void>>()
  private danmuFollowers = new Map<string, DanmuFollower>()
  private classmates = new Map<string, { schoolNumber: string; name: string }>()
  private problemDisplayIndexes = new Map<
    string,
    Map<string, string | number>
  >()
  private networkUnavailable = false
  private starting: Promise<RuntimeState> | null = null
  private answering = new Set<string>()
  private submitted = new Set<string>()
  private finishedLessons = new Set<string>()
  private pollingLifecycle: number | null = null

  constructor(
    private readonly getConfig: () => Promise<AssistantConfig>,
    private readonly logger: AppLogger,
    private readonly publish: (state: RuntimeState) => void,
    private readonly publishSpeech: (message: string) => void = () => undefined,
    private readonly dataDirectory: () => string = () => process.cwd(),
    private readonly createSocket: (
      url: string,
      options: WebSocket.ClientOptions,
    ) => WebSocket = (url, options) => new WebSocket(url, options),
  ) {}

  private isActive(lifecycle: number, lessonId?: string) {
    return (
      lifecycle === this.lifecycle &&
      this.state.listening &&
      (!lessonId ||
        this.courseList.some((course) => course.lessonId === lessonId))
    )
  }

  getState() {
    return { ...this.state }
  }
  getCourses() {
    return [...this.courseList]
  }

  private setState(patch: Partial<RuntimeState>) {
    this.state = { ...this.state, ...patch }
    this.publish(this.getState())
  }

  private host(region: string | number) {
    const index = Number(region)
    if (!Number.isInteger(index) || index < 0 || index >= hosts.length)
      throw new Error('配置的平台编号无效')
    return hosts[index]
  }

  private async request(
    path: string,
    sessionid: string,
    region: string | number,
    authorization?: string,
  ) {
    const response = await fetch(`https://${this.host(region)}${path}`, {
      headers: {
        Cookie: `sessionid=${sessionid}`,
        'User-Agent': userAgent,
        ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`课堂服务返回 HTTP ${response.status}`)
    return response.json() as Promise<Record<string, unknown>>
  }

  async validateSession() {
    const config = await this.getConfig()
    if (!config.sessionid) {
      this.setState({
        connected: false,
        userName: null,
        error: '尚未登录，请先扫码登录',
      })
      return false
    }
    try {
      const result = await this.request(
        '/api/v3/user/basic-info',
        config.sessionid,
        config.region,
      )
      const data = result.data as Record<string, unknown> | undefined
      if (result.code !== 0 || !data || typeof data.name !== 'string')
        throw new Error('登录状态无效或已过期')
      this.userId = String(data.id ?? '')
      if (!this.userId) throw new Error('账号信息缺少用户 ID')
      this.setState({
        connected: true,
        userName: data.name,
        error: null,
        lastUpdated: new Date().toISOString(),
      })
      await this.logger.write('INFO', '登录', `已验证账号 ${data.name}`)
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法验证登录状态'
      this.setState({ connected: false, userName: null, error: message })
      await this.logger.write('ERROR', '登录', message)
      return false
    }
  }

  start(): Promise<RuntimeState> {
    if (this.starting) return this.starting
    if (this.state.listening) return Promise.resolve(this.getState())
    const lifecycle = ++this.lifecycle
    const starting = this.startListening(lifecycle)
    this.starting = starting
    void starting
      .finally(() => {
        if (this.starting === starting) this.starting = null
      })
      .catch(() => undefined)
    return starting
  }

  private async startListening(lifecycle: number) {
    const valid = await this.validateSession()
    if (!valid || lifecycle !== this.lifecycle) return this.getState()
    this.setState({ listening: true, error: null })
    await this.logger.write('INFO', '监听', '开始轮询进行中的课程')
    await this.poll(lifecycle)
    if (this.isActive(lifecycle))
      this.timer = setInterval(() => void this.poll(lifecycle), 30000)
    return this.getState()
  }

  async stop() {
    this.lifecycle += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.starting = null
    for (const socket of this.lessons.values()) socket.close()
    this.lessons.clear()
    this.joiningLessons.clear()
    this.presentationLoads.clear()
    this.problemAnswers.clear()
    this.problemDisplayIndexes.clear()
    this.danmuFollowers.clear()
    this.answering.clear()
    this.submitted.clear()
    this.finishedLessons.clear()
    this.courseList = []
    this.setState({ listening: false, courses: 0 })
    await this.logger.write('INFO', '监听', '已停止课程轮询')
    return this.getState()
  }

  private async poll(lifecycle = this.lifecycle) {
    if (!this.isActive(lifecycle) || this.pollingLifecycle === lifecycle) return
    this.pollingLifecycle = lifecycle
    try {
      const config = await this.getConfig()
      const result = await this.request(
        '/api/v3/classroom/on-lesson',
        config.sessionid,
        config.region,
      )
      if (!this.isActive(lifecycle)) return
      const data = result.data as Record<string, unknown> | undefined
      const raw = data?.onLessonClassrooms
      if (result.code !== 0 || !Array.isArray(raw))
        throw new Error('课程列表响应格式无效')
      const courses = raw
        .map((item) => {
          const row = item as Record<string, unknown>
          const lessonId = String(row.lessonId ?? '')
          const previous = this.courseList.find(
            (course) => course.lessonId === lessonId,
          )
          return {
            lessonId,
            courseName: String(row.courseName ?? '未命名课程'),
            classroomId: String(row.classroomId ?? ''),
            title: previous?.title ?? null,
            teacher: previous?.teacher ?? null,
            startTime: previous?.startTime ?? null,
            status: this.lessons.has(lessonId)
              ? ('connected' as const)
              : this.joiningLessons.has(lessonId)
                ? ('joining' as const)
                : ('waiting' as const),
          }
        })
        .filter(
          (course) =>
            course.lessonId &&
            course.classroomId &&
            !this.finishedLessons.has(course.lessonId),
        )
      const changed =
        JSON.stringify(courses) !== JSON.stringify(this.courseList)
      this.courseList = courses
      const activeIds = new Set(courses.map((course) => course.lessonId))
      for (const [id, socket] of this.lessons) {
        if (!activeIds.has(id)) {
          socket.close()
          this.lessons.delete(id)
        }
      }
      for (const course of courses) {
        if (
          !this.lessons.has(course.lessonId) &&
          !this.joiningLessons.has(course.lessonId)
        ) {
          this.joiningLessons.add(course.lessonId)
          void this.joinLesson(
            course,
            config.sessionid,
            config.region,
            lifecycle,
          ).finally(() => {
            if (lifecycle === this.lifecycle)
              this.joiningLessons.delete(course.lessonId)
          })
        }
      }
      this.setState({
        courses: courses.length,
        lastUpdated: new Date().toISOString(),
        error: null,
      })
      if (this.networkUnavailable) {
        this.networkUnavailable = false
        await this.logger.write(
          'INFO',
          '网络状态',
          '网络已恢复，课堂监听继续运行',
        )
        void this.speak('网络已恢复，监听开始', 'network_info')
      }
      if (changed)
        await this.logger.write(
          'INFO',
          '课程监听',
          `当前进行中课程：${courses.length} 门`,
        )
    } catch (error) {
      if (!this.isActive(lifecycle)) return
      const message = error instanceof Error ? error.message : '课程轮询失败'
      this.setState({ error: message, lastUpdated: new Date().toISOString() })
      if (isNetworkFailure(error)) {
        if (!this.networkUnavailable) {
          this.networkUnavailable = true
          await this.logger.write(
            'WARNING',
            '网络状态',
            '网络异常，课程监听将持续重试',
          )
          void this.speak('网络异常，监听中断', 'network_info')
        }
      } else {
        await this.logger.write('WARNING', '课程监听', message)
      }
    } finally {
      if (this.pollingLifecycle === lifecycle) this.pollingLifecycle = null
    }
  }

  private async joinLesson(
    course: Course,
    sessionid: string,
    region: string | number,
    lifecycle: number,
  ) {
    const host = this.host(region)
    try {
      await this.logger.write(
        'INFO',
        '课程监听',
        `准备加入课程：${course.courseName}`,
      )
      if (!this.isActive(lifecycle, course.lessonId)) return
      const response = await fetch(`https://${host}/api/v3/lesson/checkin`, {
        method: 'POST',
        headers: {
          Cookie: `sessionid=${sessionid}`,
          'User-Agent': userAgent,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: 5, lessonId: course.lessonId }),
        signal: AbortSignal.timeout(15000),
      })
      const setAuth = response.headers.get('set-auth')
      const result = (await response.json()) as {
        code?: number
        msg?: string
        data?: { lessonToken?: string }
      }
      if (!this.isActive(lifecycle, course.lessonId)) return
      if (!response.ok || result.code !== 0 || !result.data?.lessonToken)
        throw new Error(`签到失败：${result.msg ?? `HTTP ${response.status}`}`)
      const lessonInfo = await this.request(
        '/api/v3/lesson/basic-info',
        sessionid,
        region,
        setAuth ?? undefined,
      )
      if (!this.isActive(lifecycle, course.lessonId)) return
      const lessonData = lessonInfo.data as Record<string, unknown> | undefined
      const startTime = Number(lessonData?.startTime)
      this.updateCourse(course.lessonId, {
        title: String(lessonData?.title ?? ''),
        teacher: String(
          (lessonData?.teacher as Record<string, unknown> | undefined)?.name ??
            '',
        ),
        startTime: Number.isFinite(startTime)
          ? new Date(startTime).toISOString()
          : null,
        status: 'joining',
      })
      const config = await this.getConfig()
      const delayConfig = config.sign_config.delay_time
      const delay = calculateJoinDelay(startTime, delayConfig)
      if (delay > 0) {
        await this.logger.write(
          'INFO',
          '课程监听',
          `${course.courseName} 课程已开始，将在 ${delay} 秒后加入课堂`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
      }
      if (!this.isActive(lifecycle, course.lessonId)) return
      const socket = this.createSocket(`wss://${host}/wsapp/`, {
        headers: {
          Cookie: `sessionid=${sessionid}`,
          'User-Agent': userAgent,
          ...(setAuth ? { Authorization: `Bearer ${setAuth}` } : {}),
        },
      })
      const displayIndexes =
        this.problemDisplayIndexes.get(course.lessonId) ??
        new Map<string, string | number>()
      this.problemDisplayIndexes.set(course.lessonId, displayIndexes)
      this.lessons.set(course.lessonId, socket)
      socket.on('open', () => {
        if (!this.isActive(lifecycle, course.lessonId)) {
          socket.close()
          return
        }
        this.updateCourse(course.lessonId, { status: 'connected' })
        socket.send(
          JSON.stringify({
            op: 'hello',
            userid: this.userId,
            role: 'student',
            auth: result.data?.lessonToken,
            lessonid: course.lessonId,
          }),
        )
      })
      socket.on('message', (raw) => {
        if (!this.isActive(lifecycle, course.lessonId)) return
        try {
          const event = JSON.parse(raw.toString()) as Record<string, unknown>
          if (event.op === 'hello') {
            collectProblemDisplayIndexes(event.timeline, displayIndexes)
            const indexing = this.indexPresentations(
              event,
              sessionid,
              region,
              course,
              setAuth ?? '',
              lifecycle,
            )
            this.presentationLoads.set(course.lessonId, indexing)
            const unlocked = Array.isArray(event.unlockedproblem)
              ? event.unlockedproblem
              : []
            for (const problemid of unlocked)
              socket.send(
                JSON.stringify({
                  op: 'probleminfo',
                  lessonid: course.lessonId,
                  problemid,
                  msgid: 1,
                }),
              )
            void this.logger.write(
              'INFO',
              '课程监听',
              `${course.courseName} 已连接，待处理题目 ${unlocked.length} 道`,
            )
            void this.speak(`${course.courseName}已连接`, 'course_info')
          } else if (event.op === 'probleminfo') {
            void this.queueAnswer(
              event,
              course,
              sessionid,
              region,
              lifecycle,
              setAuth ?? '',
            )
          } else if (event.op === 'callpaused') {
            const name = String(event.name ?? '未知同学')
            const ownCall = name === this.state.userName
            const message = `${course.courseName}点名了，点到了：${name}`
            void this.logger.write('INFO', '课堂点名', message)
            void this.speak(message, ownCall ? 'im_called' : 'others_called')
          } else if (event.op === 'newdanmu') {
            void this.handleDanmu(
              event,
              course,
              sessionid,
              region,
              lifecycle,
              setAuth ?? '',
            ).catch((error) =>
              this.logger.write('WARNING', '课堂弹幕', String(error)),
            )
          } else if (
            event.op === 'presentationupdated' ||
            event.op === 'presentationcreated'
          ) {
            const presentationId = event.presentation
            if (presentationId === undefined || presentationId === null) {
              void this.logger.write(
                'WARNING',
                '课件题库',
                `${course.courseName} ${String(event.op)} 消息缺少 presentation 字段`,
              )
            } else {
              const indexing = Promise.resolve(
                this.presentationLoads.get(course.lessonId),
              ).then(() =>
                this.indexPresentations(
                  { presentation: presentationId },
                  sessionid,
                  region,
                  course,
                  setAuth ?? '',
                  lifecycle,
                  event.op === 'presentationupdated',
                ),
              )
              this.presentationLoads.set(course.lessonId, indexing)
              void this.speak(
                `${course.courseName}有课件${event.op === 'presentationupdated' ? '更新' : '新增'}`,
                'course_info',
              )
            }
          } else if (event.op === 'unlockproblem') {
            const problem = event.problem as Record<string, unknown> | undefined
            collectProblemDisplayIndexes(
              [
                {
                  type: 'problem',
                  prob: problem?.prob,
                  sid: problem?.sid,
                  si: problem?.si,
                },
              ],
              displayIndexes,
            )
            const record = this.problemAnswers.get(
              `${course.lessonId}:${String(problem?.sid ?? '')}`,
            )
            if (record && problem?.si !== undefined && problem.si !== null) {
              record.index = String(problem.si)
              record.slides = normalizePresentationSlides(
                record.slides,
                displayIndexes,
              )
            }
            if (problem?.sid)
              socket.send(
                JSON.stringify({
                  op: 'probleminfo',
                  lessonid: course.lessonId,
                  problemid: problem.sid,
                  msgid: 1,
                }),
              )
          } else if (event.op === 'lessonfinished') {
            void this.logger.write(
              'INFO',
              '课程监听',
              `${course.courseName} 已下课`,
            )
            void this.speak(`${course.courseName}已下课`, 'course_info')
            this.finishedLessons.add(course.lessonId)
            this.courseList = this.courseList.filter(
              (entry) => entry.lessonId !== course.lessonId,
            )
            this.setState({
              courses: this.courseList.length,
              lastUpdated: new Date().toISOString(),
            })
            socket.close()
          } else {
            void this.logger.write(
              'INFO',
              '课堂事件',
              `${course.courseName}: ${String(event.op ?? 'unknown')}`,
            )
          }
        } catch {
          void this.logger.write(
            'WARNING',
            '课堂事件',
            `${course.courseName} 收到无法解析的 WebSocket 消息`,
          )
        }
      })
      socket.on('error', () => {
        if (!this.isActive(lifecycle, course.lessonId)) return
        void this.logger.write(
          'ERROR',
          '课程监听',
          `${course.courseName} WebSocket 连接异常`,
        )
        void this.speak(`${course.courseName}网络连接异常`, 'network_info')
      })
      socket.on('close', () => {
        if (this.lessons.get(course.lessonId) === socket) {
          this.lessons.delete(course.lessonId)
          this.updateCourse(course.lessonId, { status: 'waiting' })
        }
      })
    } catch (error) {
      if (!this.isActive(lifecycle, course.lessonId)) return
      const message = error instanceof Error ? error.message : '加入课程失败'
      await this.logger.write(
        'ERROR',
        '课程监听',
        `${course.courseName}: ${message}`,
      )
    }
  }

  private updateCourse(lessonId: string, patch: Partial<Course>) {
    const index = this.courseList.findIndex(
      (course) => course.lessonId === lessonId,
    )
    if (index < 0) return
    this.courseList = this.courseList.map((course) =>
      course.lessonId === lessonId ? { ...course, ...patch } : course,
    )
    this.setState({
      courses: this.courseList.length,
      lastUpdated: new Date().toISOString(),
    })
  }

  private async queueAnswer(
    event: Record<string, unknown>,
    course: Course,
    sessionid: string,
    region: string | number,
    lifecycle: number,
    authorization: string,
  ) {
    const receivedAt = Date.now()
    const problemId = String(event.problemid ?? '')
    await this.presentationLoads.get(course.lessonId)
    const problem = this.problemAnswers.get(`${course.lessonId}:${problemId}`)
    const key = `${course.lessonId}:${problem?.id || problemId}`
    if (
      !problemId ||
      !this.isActive(lifecycle, course.lessonId) ||
      this.answering.has(key) ||
      this.submitted.has(key)
    )
      return
    this.answering.add(key)
    try {
      await this.answerProblem(
        event,
        course,
        sessionid,
        region,
        lifecycle,
        key,
        receivedAt,
        authorization,
      )
    } catch (error) {
      if (this.isActive(lifecycle, course.lessonId))
        await this.logger.write(
          'ERROR',
          '自动答题',
          `${course.courseName} 答题处理失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
    } finally {
      if (lifecycle === this.lifecycle) this.answering.delete(key)
    }
  }

  private async handleDanmu(
    event: Record<string, unknown>,
    course: Course,
    sessionid: string,
    region: string | number,
    lifecycle: number,
    authorization: string,
  ) {
    const content = typeof event.danmu === 'string' ? event.danmu.trim() : ''
    const userId = String(event.userid ?? '')
    if (!content || !userId) return
    const config = await this.getConfig()

    let classmate = this.classmates.get(userId)
    if (!classmate) {
      try {
        const result = await this.request(
          `/v/course_meta/fetch_user_info_new?query_user_id=${encodeURIComponent(userId)}&classroom_id=${encodeURIComponent(course.classroomId)}`,
          sessionid,
          region,
          authorization,
        )
        const data = result.data as Record<string, unknown> | undefined
        classmate = {
          schoolNumber: String(data?.school_number ?? ''),
          name: String(data?.name ?? '同学'),
        }
        this.classmates.set(userId, classmate)
      } catch {
        classmate = { schoolNumber: '', name: '同学' }
        this.classmates.set(userId, classmate)
      }
    }
    await this.logger.write(
      'INFO',
      '课堂弹幕',
      `${course.courseName} ${classmate.schoolNumber}${classmate.name}：${content}`,
    )
    void this.speak(`${classmate.name}发送了弹幕：${content}`, 'others_danmu')
    if (
      !config.auto_danmu ||
      userId === this.userId ||
      !this.isActive(lifecycle, course.lessonId)
    )
      return

    let follower = this.danmuFollowers.get(course.lessonId)
    if (!follower) {
      follower = new DanmuFollower()
      this.danmuFollowers.set(course.lessonId, follower)
    }
    const limit = Number(config.danmu_config.danmu_limit ?? 5)
    if (!follower.shouldSend(content, limit)) return

    const payload = {
      extra: '',
      fromStart: '50',
      lessonId: course.lessonId,
      message: content,
      requiredCensor: false,
      showStatus: true,
      target: '',
      userName: '',
      wordCloud: true,
    }
    try {
      if (!this.isActive(lifecycle, course.lessonId)) return
      const response = await fetch(
        `https://${this.host(region)}/api/v3/lesson/danmu/send`,
        {
          method: 'POST',
          headers: {
            Cookie: `sessionid=${sessionid}`,
            'User-Agent': userAgent,
            'Content-Type': 'application/json',
            ...(authorization
              ? { Authorization: `Bearer ${authorization}` }
              : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        },
      )
      const result = (await response.json()) as { code?: number }
      if (!response.ok || result.code !== 0)
        throw new Error(
          `HTTP ${response.status}, code ${String(result.code ?? 'unknown')}`,
        )
      await this.logger.write(
        'INFO',
        '自动弹幕',
        `${course.courseName} 跟随发送成功：${content}`,
      )
      void this.speak(
        `${course.courseName}弹幕发送成功：${content}`,
        'send_danmu',
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : '请求失败'
      await this.logger.write(
        'WARNING',
        '自动弹幕',
        `${course.courseName} 跟随发送失败：${detail}`,
      )
    }
  }

  private async indexPresentations(
    event: Record<string, unknown>,
    sessionid: string,
    region: string | number,
    course: Course,
    lessonToken: string,
    lifecycle: number,
    forceRefresh = false,
  ) {
    const courseName = course.courseName
    const timeline = Array.isArray(event.timeline)
      ? (event.timeline as Record<string, unknown>[])
      : []
    const displayIndexes =
      this.problemDisplayIndexes.get(course.lessonId) ??
      new Map<string, string | number>()
    this.problemDisplayIndexes.set(course.lessonId, displayIndexes)
    collectProblemDisplayIndexes(timeline, displayIndexes)
    const ids = new Set(
      timeline
        .filter((item) => item.type === 'slide' && item.pres)
        .map((item) => String(item.pres)),
    )
    if (event.presentation) ids.add(String(event.presentation))
    for (const id of ids) {
      try {
        const result = await this.request(
          `/api/v3/lesson/presentation/fetch?presentation_id=${encodeURIComponent(id)}`,
          sessionid,
          region,
          lessonToken,
        )
        if (!this.isActive(lifecycle, course.lessonId)) return
        const data = result.data as Record<string, unknown> | undefined
        const slides = Array.isArray(data?.slides)
          ? ((data.slides as Record<string, unknown>[]).filter(
              (slide) => slide.index !== undefined && slide.index !== null,
            ) as Array<
              Record<string, unknown> & {
                index: string | number
                cover?: string
                problem?: Record<string, unknown>
              }
            >)
          : []
        const normalizedSlides = normalizePresentationSlides(
          slides,
          displayIndexes,
        )
        const presentationTitle = String(data?.title ?? '未知演示文稿')
        for (const slide of normalizedSlides) {
          const problem = slide.problem as Record<string, unknown> | undefined
          if (!problem) continue
          const record = {
            id: String(
              problem.problemId ?? problem.id ?? problem.sid ?? slide.id ?? '',
            ),
            problemType: Number(problem.problemType),
            answer: problem.answers,
            result: problem.result,
            index: String(slide.index ?? ''),
            title: presentationTitle,
            cover: typeof slide.cover === 'string' ? slide.cover : '',
            slides: normalizedSlides,
          }
          for (const key of [
            problem.problemId,
            problem.id,
            problem.sid,
            slide.id,
            slide.slideId,
            ...(Array.isArray(problem.slideIds) ? problem.slideIds : []),
          ]) {
            if (key !== undefined && key !== null)
              this.problemAnswers.set(
                `${course.lessonId}:${String(key)}`,
                record,
              )
          }
        }
        const width = Number(data?.width)
        const height = Number(data?.height)
        if (
          normalizedSlides.length &&
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0 &&
          width <= 20000 &&
          height <= 20000
        )
          void this.processPresentation(
            normalizedSlides,
            presentationTitle,
            courseName,
            width,
            height,
            forceRefresh,
          )
        await this.logger.write(
          'INFO',
          '课件题库',
          `${courseName} 已载入课件题目 ${normalizedSlides.filter((slide) => slide.problem).length} 道`,
        )
      } catch {
        await this.logger.write(
          'WARNING',
          '课件题库',
          `${courseName} 课件题库加载失败`,
        )
      }
    }
  }

  private async processPresentation(
    slides: Array<
      Record<string, unknown> & {
        index: string | number
        cover?: string
        problem?: Record<string, unknown>
      }
    >,
    title: string,
    lessonName: string,
    width: number,
    height: number,
    forceRefresh = false,
  ) {
    try {
      const result = await downloadPresentation({
        slides,
        title,
        lessonName,
        dimensions: { width, height },
        root: this.dataDirectory(),
        forceRefresh,
        logger: this.logger,
      })
      const analyzer = new AiAnalyzer(
        this.getConfig,
        this.logger,
        this.dataDirectory(),
      )
      void analyzer
        .analyzePresentation(lessonName, title, slides, result.imageDirectory)
        .catch((error) =>
          this.logger.write(
            'ERROR',
            'AI 分析',
            `${title} 分析失败：${error instanceof Error ? error.message : '未知错误'}`,
          ),
        )
    } catch {
      await this.logger.write(
        'WARNING',
        '课件下载',
        `${lessonName}：${title} 下载或 PDF 生成失败`,
      )
    }
  }

  private async answerProblem(
    event: Record<string, unknown>,
    course: Course,
    sessionid: string,
    region: string | number,
    lifecycle: number,
    answerKey: string,
    receivedAt: number,
    authorization: string,
  ) {
    await this.presentationLoads.get(course.lessonId)
    if (!this.isActive(lifecycle, course.lessonId)) return
    const config = await this.getConfig()
    if (!this.isActive(lifecycle, course.lessonId)) return
    const eventProblemId = String(event.problemid ?? '')
    const timeLeft = remainingAnswerTime(event, receivedAt)
    if (timeLeft <= 0 && timeLeft !== -1) return
    const problem = this.problemAnswers.get(
      `${course.lessonId}:${eventProblemId}`,
    )
    const problemId = problem?.id || eventProblemId
    if (problem?.result !== null && problem?.result !== undefined) return
    if (!config.auto_answer) {
      const message = `${course.courseName} 收到题目，但自动答题已关闭`
      await this.logger.write('INFO', '课堂题目', message)
      void this.speak(message, 'receive_problem')
      return
    }
    if (problem?.problemType === 3) return
    const cached = problem
      ? await this.cachedAnswer(
          course.courseName,
          problem.title,
          problem.index,
          problem.slides,
        )
      : undefined
    let answer = hasUsableAnswer(problem?.answer) ? problem?.answer : cached
    if (
      !hasUsableAnswer(answer) &&
      problem?.cover &&
      config.enable_ai_analysis &&
      config.openai_api_key
    ) {
      const title = safePathComponent(problem.title)
      const imageDirectory = join(
        this.dataDirectory(),
        'downloads',
        'rainclasscache',
        safePathComponent(course.courseName),
        title,
      )
      const imagePath = slideImagePath(imageDirectory, problem.index)
      try {
        await downloadSlideImage(problem.cover, imagePath)
        const analyzer = new AiAnalyzer(
          this.getConfig,
          this.logger,
          this.dataDirectory(),
        )
        answer = await analyzer.analyzeLiveSlide(
          course.courseName,
          problem.title,
          problem.index,
          imagePath,
          problem.slides,
          imageDirectory,
        )
      } catch (error) {
        await this.logger.write(
          'WARNING',
          'AI 分析',
          `${problem.title} 第 ${problem.index} 页现场分析失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
    }
    if (!this.isActive(lifecycle, course.lessonId)) return
    if (
      !problem ||
      !hasUsableAnswer(answer) ||
      (problem.result !== null && problem.result !== undefined)
    ) {
      if (problem?.result !== null && problem?.result !== undefined) return
      const message = `${course.courseName} 未找到可用答案，请人工处理`
      await this.logger.write('WARNING', '课堂题目', message)
      void this.notifyAnswerResult(message, config)
      void this.speak(message, 'answer_result')
      return
    }
    const delayConfig = config.answer_config.answer_delay as {
      type?: number
      custom?: { percent?: number }
    }
    const remainingBeforeDelay = remainingAnswerTime(event, receivedAt)
    if (remainingBeforeDelay !== -1 && remainingBeforeDelay <= 0) return
    const wait =
      remainingBeforeDelay !== -1 && remainingBeforeDelay < 15
        ? 0
        : calculateAnswerDelay(
            remainingBeforeDelay,
            Number(delayConfig.type ?? 1),
            Number(delayConfig.custom?.percent ?? 50),
          )
    if (wait > 0)
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
    if (
      !this.isActive(lifecycle, course.lessonId) ||
      this.submitted.has(answerKey)
    )
      return
    const remaining = remainingAnswerTime(event, receivedAt)
    if (remaining !== -1 && remaining <= 0) return
    const candidates = submissionCandidates(problem.problemType, answer)
    for (const [index, result] of candidates.entries()) {
      const latestConfig = await this.getConfig()
      if (
        !latestConfig.auto_answer ||
        latestConfig.sessionid !== sessionid ||
        !this.isActive(lifecycle, course.lessonId)
      )
        return
      if (
        remainingAnswerTime(event, receivedAt) !== -1 &&
        remainingAnswerTime(event, receivedAt) <= 0
      )
        return
      const response = await fetch(
        `https://${this.host(region)}/api/v3/lesson/problem/answer`,
        {
          method: 'POST',
          headers: {
            Cookie: `sessionid=${sessionid}`,
            'User-Agent': userAgent,
            'Content-Type': 'application/json',
            ...(authorization
              ? { Authorization: `Bearer ${authorization}` }
              : {}),
          },
          body: JSON.stringify({
            problemId,
            problemType: problem.problemType,
            dt: Math.floor(Date.now() / 1000),
            result,
          }),
          signal: AbortSignal.timeout(15000),
        },
      )
      if (!this.isActive(lifecycle, course.lessonId)) return
      const text = await response.text()
      let payload: { code?: number; msg?: string }
      try {
        payload = JSON.parse(text) as { code?: number; msg?: string }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw new Error('答题响应不是对象')
      } catch (error) {
        if (
          index + 1 < candidates.length &&
          shouldRetrySubmission(problem.problemType, text, String(error))
        )
          continue
        const message = `${course.courseName} 答题响应解析失败`
        await this.logger.write('ERROR', '自动答题', message)
        void this.notifyAnswerResult(message, config)
        void this.speak(message, 'answer_result')
        return
      }
      const success = response.ok && payload.code === 0
      const message = success
        ? `${course.courseName} 答题提交成功`
        : `${course.courseName} 答题失败：${String(payload.msg ?? '服务端拒绝')}`
      await this.logger.write(success ? 'INFO' : 'WARNING', '自动答题', message)
      if (success) {
        this.submitted.add(answerKey)
        problem.result = result
      }
      void this.notifyAnswerResult(message, config)
      void this.speak(message, 'answer_result')
      return
    }
  }

  private async notifyAnswerResult(message: string, config: AssistantConfig) {
    await sendEmailNotificationIfNeeded(message, config, this.logger)
  }

  private async speak(
    message: string,
    category: keyof AssistantConfig['audio_config']['audio_type'],
  ) {
    const config = await this.getConfig()
    if (config.audio_on && config.audio_config.audio_type[category])
      this.publishSpeech(message)
  }

  private async cachedAnswer(
    lessonName: string,
    title: string,
    index: string,
    slides: Parameters<typeof resolveCachedAnswer>[2],
  ) {
    const cachePath = join(
      this.dataDirectory(),
      'ai_answers_cache',
      `${safePathComponent(lessonName)}_${safePathComponent(title)}.json`,
    )
    try {
      return resolveCachedAnswer(
        JSON.parse(await readFile(cachePath, 'utf8')),
        index,
        slides,
      )
    } catch {
      /* Cache is optional; fall back to embedded course answers. */
    }
    return undefined
  }
}
