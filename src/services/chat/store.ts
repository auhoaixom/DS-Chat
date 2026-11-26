import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { useSettings } from '../settings.js'
import { acquireKeepAlive, releaseKeepAlive, reportKeepAliveProgress } from '../keepAlive.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import {
  applyCompaction,
  buildCompaction,
  estimateRequestTokens,
  getSessionModel,
  isContextOverflowError,
  needsCompaction,
  requestKeyOf,
  withCompactionSummary,
  type CompactionProgress,
} from './compaction.js'
import { upgradeSession } from './contentVersion.js'
import { accrueCost } from './cost.js'
import * as db from './db.js'
import { deriveDocumentPrices, commitDerivedPrices, hydrateFileTokens, type DocumentEntry } from './fileTokens.js'
import { SYSTEM_PROMPT, safetyCheckField, serverTools } from './prompt.js'
import { supportsServerFeatures } from './capabilities.js'
import { ESTIMATE_VERSION, estimateTokens, getPromptTokens } from './tokens.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 服务端判定超长后，压缩并重发的最多次数（第 2 次换成抢救式压缩） */
const OVERFLOW_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000
/** 应用在后台时，流式增量合并提交的最小间隔（毫秒） */
const HIDDEN_FLUSH_INTERVAL = 250
/**
 * 连接层断掉后自动接着写的次数上限。
 * 只有一次：再断就照常报错——反复自动重试等于拿用户的钱试运气。
 */
const AUTO_CONTINUE_LIMIT = 1
/**
 * 断网期间的"空转重试"：请求根本发不出去（拿不到任何事件），不花钱，可以多试几次。
 * 换网的瞬间连接先断、网络几秒后才回来，不等就会把唯一的机会打空
 * （真机实测：网络 8 秒后回来，第 1 秒就重试必然失败）。
 * 不用 `navigator.onLine` 判断——WebView 在双卡机型上亮着它照样是 true。
 */
const AUTO_RETRY_LIMIT = 8
const AUTO_RETRY_DELAY_MS = 1500
const AUTO_RETRY_WINDOW_MS = 20_000

/** 可被中止打断的等待：用户点停止时立刻返回 */
const sleepUnlessAborted = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /** 正在压缩上下文的会话，供界面显示进度 */
  compacting: Record<string, CompactionRun>
}

/** 一次上下文压缩的进行态 */
export type CompactionRun = CompactionProgress & {
  mode: 'manual' | 'auto'
  startedAt: number
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
  compacting: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt &&
  // 置顶只改这个字段，漏掉它会让「已打开的会话」置顶后列表不刷新
  Boolean(a.pinned) === Boolean(b.pinned)

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
      return
    }
    // 回到前台：把后台期间被合并掉的那一段补上，否则最后几个字符要等下一个事件才上屏
    for (const [, flush] of streamFlushes) {
      flush()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: useSettings.getState().model,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      // 附件真值先水合：第一次估算就能用上，读不到就静默退回占位值
      await hydrateFileTokens()
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      // 先按内容版本把旧记录升到当前版本：没有改动时返回同一个对象。
      const upgraded = upgradeSession(stored)
      const settled = settleInterrupted(normalizeSession(upgraded.session))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      // 读出来时被改过就写回，下次打开不必再迁一遍。
      // 比本程序新的记录例外：那份里的字段我们不认识，照着内存里的样子写回去等于把它们洗掉。
      if (session !== stored && !upgraded.fromFuture) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 置顶开关：只影响会话列表分组，属于本地偏好——不进导出包，也不改 updatedAt
 * （否则一置顶就会跳到「今天」分组里）。
 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, pinned: pinned || undefined }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, pinned: pinned || undefined } : session
      ),
    }))
    void db.setSessionPinned(id, pinned).catch(db.reportStorageError('pin session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/** 手动压缩的取消句柄；自动压缩复用本轮回复的 controller，停止生成即停止压缩 */
const compactionControllers = new Map<string, AbortController>()

const setCompactionRun = (sessionId: string, run: CompactionRun | null) => {
  set((state) => {
    const rest = Object.entries(state.compacting).filter(([id]) => id !== sessionId)
    return {
      compacting: Object.fromEntries(run ? [...rest, [sessionId, run]] : rest),
    }
  })
}

/**
 * 生成压缩记录并写入会话。force 为 false 时先按阈值判断，不需要压缩就直接返回。
 * 摘要请求本身用当前回复的 signal，用户点停止会一起停下。
 */
const runCompaction = async (
  sessionId: string,
  mode: 'manual' | 'auto',
  signal: AbortSignal,
  { force = false, aggressive = false }: { force?: boolean; aggressive?: boolean } = {}
): Promise<'done' | 'empty' | 'no-gain' | 'skipped'> => {
  const session = getSession(sessionId)
  const apiKey = useSettings.getState().apiKey ?? ''
  if (!session || !apiKey) {
    return 'skipped'
  }
  if (!force && !needsCompaction(session)) {
    return 'skipped'
  }
  const startedAt = Date.now()
  setCompactionRun(sessionId, {
    phase: 'summary',
    done: 0,
    total: 1,
    chars: 0,
    mode,
    startedAt,
  })
  try {
    const outcome = await buildCompaction({
      session,
      apiKey,
      model: getSessionModel(session),
      mode,
      signal,
      aggressive,
      onProgress: (progress) => setCompactionRun(sessionId, { ...progress, mode, startedAt }),
    })
    if (outcome.ok) {
      const { compaction, costs } = outcome
      updateSession(sessionId, (current) => ({
        ...current,
        compaction,
        // 压缩用的请求不属于任何一条回复：只进会话合计，不挂在某条回答头上
        ...(costs.length > 0
          ? { extraCosts: [...(current.extraCosts ?? []), ...costs] }
          : {}),
      }))
      persist(sessionId)
      return 'done'
    }
    // 没压成也花过钱（no-gain 的那一次摘要请求），照样记账，否则合计会少一截
    if (outcome.costs.length > 0) {
      const { costs } = outcome
      updateSession(sessionId, (current) => ({
        ...current,
        extraCosts: [...(current.extraCosts ?? []), ...costs],
      }))
      persist(sessionId)
    }
    return outcome.reason
  } finally {
    setCompactionRun(sessionId, null)
  }
}

/** empty：消息太少；no-gain：压完省不下上下文，已作废 */
export type CompactionResult = 'done' | 'empty' | 'no-gain' | 'busy' | 'failed'

/** 手动压缩当前分支：消息太少、正在生成或已在压缩时不做 */
export const compactSession = async (sessionId: string): Promise<CompactionResult> => {
  if (
    get().importingHistory ||
    deletingSessions.has(sessionId) ||
    getStreamController(sessionId) ||
    compactionControllers.has(sessionId) ||
    Object.hasOwn(get().compacting, sessionId)
  ) {
    return 'busy'
  }
  if (!getSession(sessionId)) {
    return 'empty'
  }
  const controller = new AbortController()
  compactionControllers.set(sessionId, controller)
  try {
    const result = await runCompaction(sessionId, 'manual', controller.signal, { force: true })
    return result === 'skipped' ? 'empty' : result
  } catch {
    return controller.signal.aborted ? 'empty' : 'failed'
  } finally {
    compactionControllers.delete(sessionId)
  }
}

export const cancelCompaction = (sessionId: string) => {
  compactionControllers.get(sessionId)?.abort()
}

/** 撤销压缩：删掉记录，原始消息重新进入请求 */
export const undoCompaction = (sessionId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId) || !getSession(sessionId)?.compaction) {
    return
  }
  updateSession(sessionId, (session) => {
    const next = { ...session }
    delete next.compaction
    return next
  })
  persist(sessionId)
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用当前设置的模型和开关。
    model: previous.model ?? useSettings.getState().model,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 文档附件的定价：第一次带着某份文档发出请求、拿到服务端用量之后，
 * 用「实测 − 这次请求的估算」反推它的真实开销，写进 meta，此后一直用它
 * （`count_tokens` 对文档只算壳子，用不了——实测 44 vs 真发 599）。
 *
 * 顺带把这一枪的 `promptEstimate` 修正到新尺子：否则下一次测算会把这笔校准
 * 当成"对话变长了"，数字凭空上跳。
 */
const calibrateDocuments = async (
  reply: AssistantMessage,
  prepared: { history: Message[]; question: UserMessage }
): Promise<AssistantMessage> => {
  const estimate = reply.promptEstimate
  if (!reply.usage || estimate === undefined) {
    return reply
  }
  const counts = new Map<string, DocumentEntry>()
  for (const message of [...prepared.history, prepared.question]) {
    if (message.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      // 图片走上传后的一次 count_tokens；没有 serverId 的附件根本不进请求
      if (file.isImage || !file.serverId) {
        continue
      }
      counts.set(file.id, { file, count: (counts.get(file.id)?.count ?? 0) + 1 })
    }
  }
  if (counts.size === 0) {
    return reply
  }
  const derived = deriveDocumentPrices([...counts.values()], getPromptTokens(reply.usage), estimate)
  if (!derived) {
    return reply
  }
  await commitDerivedPrices(derived, reply.servedModel ?? reply.model ?? '')
  return { ...reply, promptEstimate: Math.max(0, estimate + derived.delta) }
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(request.history).toReversed()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 连接层失败：**拿不到 HTTP 状态码**，说明这不是服务端对我们的结论。
 * 断网、切网络时连接被掐、流读到一半断掉都落在这里；HTTP 4xx/5xx 是服务端给的答案，不自动重试。
 */
const isConnectionLoss = (error: unknown): boolean =>
  !(error instanceof ApiError) || error.status === undefined

/**
 * 已经写出来的字数（思考 + 正文）。
 * 只用于通知里的进度，两秒才上报一次，这点遍历开销可以忽略。
 */
const replyChars = (reply: AssistantMessage): number => {
  let total = 0
  for (const block of reply.blocks) {
    if (block.type === 'text') {
      total += block.text.length
    } else if (block.type === 'thinking') {
      total += block.thinking.length
    }
  }
  return total
}

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  // 先在进程层面保活，再发请求：用户随时可能切走，服务必须在请求之前就位
  await acquireKeepAlive()
  let reply = initial
  let frame = 0
  /** 发送前是否已经做过一次压缩判断；超限重试单独记一次，避免反复压缩 */
  let compactionTried = false
  let overflowRetries = 0
  /** 续写前缀：自动续写时换成"已经写出来的这段"，其余情况沿用调用方给的 */
  let nextPrefix = request.prefix
  /** 已经用掉的"真续写"次数（服务端真的开始生成过，是要花钱的） */
  let autoContinues = 0
  /** 断网空转的重试次数（请求没出去，不花钱） */
  let autoAttempts = 0
  /** 这一枪空转到什么时候就不再试了 */
  let autoDeadline = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)
  /**
   * 后台期间不能每个事件都刷一次：隐藏页面虽然不画帧，但 setState 本身照跑，
   * 每秒几十次纯属浪费电。250ms 合并一次；回到前台时 bindChatPersistence 会补最后一刀。
   */
  let lastHiddenFlush = 0
  const flushHidden = () => {
    const now = Date.now()
    if (now - lastHiddenFlush < HIDDEN_FLUSH_INTERVAL) {
      return
    }
    lastHiddenFlush = now
    flush()
  }

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      /** 这一枪有没有真的接到过服务端的事件（用来分清"断网空转"和"生成到一半断了"） */
      let gotReplyEvent = false
      /**
       * 这一枪的用量是否已经记账。
       * message_delta 可能多次到达（含累计值），只认第一份带 usage 的，免得重复计费。
       * 断线自动续写会重进这个循环，标记随 attempt 重置 —— 那是新的一次请求，该再记一笔。
       */
      let accrued = false
      try {
        // 发送前按阈值压缩一次；压缩失败不影响本轮请求，由超限重试兜底
        if (!compactionTried) {
          compactionTried = true
          const current = getSession(sessionId)
          if (current && needsCompaction(current, request.question)) {
            await runCompaction(sessionId, 'auto', controller.signal, { force: true }).catch(
              () => 'skipped' as const
            )
          }
        }
        // 压缩记录只替换请求里「被覆盖消息组成的开头前缀」，分支切换后失效就照常回传原文
        const { history, summary } = applyCompaction(
          request.history,
          getSession(sessionId)?.compaction
        )
        const prepared = await prepareFiles(
          sessionId,
          { ...request, history, prefix: nextPrefix },
          controller.signal
        )
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        const system = summary ? withCompactionSummary(SYSTEM_PROMPT, summary) : SYSTEM_PROMPT
        // 服务端工具、标题生成与 latest_reminder 只有 flash 系列支持，其它模型整条请求会被拒
        const model = initial.model ?? useSettings.getState().model
        const withServerFeatures = supportsServerFeatures(model)
        // 记下这次的提示侧估算：上下文占用用它和真实用量算"表面净增减"
        const promptEstimate =
          estimateRequestTokens([...prepared.history, prepared.question]) +
          estimateTokens(system)
        // 连同估算口径版本与请求形状一起存：以后口径或形状变了，这条估算/实测就不能当锚点基准
        const requestKey = requestKeyOf({
          model,
          thinking: initial.thinking ?? false,
          search: initial.search ?? false,
          hasFiles: [...prepared.history, prepared.question].some(
            (message) => message.role === 'user' && message.files.some((file) => file.serverId !== null)
          ),
        })
        reply = {
          ...reply,
          latestReminder,
          promptEstimate,
          estimateVersion: ESTIMATE_VERSION,
          requestKey,
        }
        updateReply(sessionId, reply)
        persist(sessionId)
        const messages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          withServerFeatures
        )
        // 峰谷按发起时刻定档：请求跑几十秒也可能跨过时段边界，结束时算会飘
        const requestedAt = Date.now()
        const events = streamMessage(
          useSettings.getState().apiKey ?? '',
          {
            model,
            system,
            messages,
            thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
            ...safetyCheckField(),
            tools: serverTools(model, initial.search ?? false),
            ...(withServerFeatures && titleRequests.has(controller)
              ? { title: { enabled: true } }
              : {}),
          },
          controller.signal
        )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          gotReplyEvent = true
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (event.type === 'message_delta' && event.usage && !accrued) {
            accrued = true
            reply = accrueCost(reply, event.usage, requestedAt)
            // 第一次拿到实测：给这份请求里的文档定价（已有价格的不会再动）
            reply = await calibrateDocuments(reply, prepared).catch(() => reply)
          }
          reportKeepAliveProgress(replyChars(reply))
          if (document.visibilityState === 'hidden') {
            flushHidden()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 超出上下文长度：压缩后重发；两次仍超限就按原始报错收尾。
        // 第二次改成"抢救式"压缩：只留最后一轮原文，把能削的头部都削掉。
        if (overflowRetries < OVERFLOW_RETRY_LIMIT && isContextOverflowError(error)) {
          overflowRetries += 1
          await runCompaction(sessionId, 'auto', controller.signal, {
            force: true,
            aggressive: overflowRetries > 1,
          }).catch(() => 'skipped' as const)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (isConnectionLoss(error) && reply.prefix !== false) {
          /*
           * 连接层断了（切网络、信号掉了、后台被掐）：这不是服务端的结论，
           * 已经写出来的内容不能白扔 —— 把这段当成前缀重新请求，让模型接着写。
           * 一个字都没产出时把可能残留的思考块丢掉：那样等于重发，留着会重复显示。
           *
           * 分两种：真的收到过内容的断流要花一次预算；请求压根没发出去（断网）的
           * 不花钱，在时间窗内可以反复试，等网络回来。
           */
          const started = gotReplyEvent
          const now = Date.now()
          autoDeadline ||= now + AUTO_RETRY_WINDOW_MS
          const allowed = started
            ? autoContinues < AUTO_CONTINUE_LIMIT
            : autoAttempts < AUTO_RETRY_LIMIT && now < autoDeadline
          if (allowed) {
            if (started) {
              autoContinues += 1
            } else {
              autoAttempts += 1
              await sleepUnlessAborted(AUTO_RETRY_DELAY_MS, controller.signal)
              if (controller.signal.aborted) {
                reply = settleReply(reply, 'stopped', Date.now())
                break
              }
            }
            nextPrefix = { ...reply, blocks: getReplyText(reply) ? reply.blocks : [] }
            reply = { ...nextPrefix, status: 'streaming', error: undefined, stopReason: undefined }
            updateReply(sessionId, reply)
            continue
          }
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error instanceof ApiError ? error.kind : 'protocol',
            message: error instanceof Error ? error.message : String(error),
            status: error instanceof ApiError ? error.status : undefined,
            localMessage: error instanceof ApiError ? error.localMessage : undefined,
          })
          break
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    void releaseKeepAlive()
  }
}
