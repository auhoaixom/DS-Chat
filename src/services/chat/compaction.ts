import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { getVisibleMessages } from './branches.js'
import { getReplyText } from './reply.js'
import { estimateMessageTokens, estimateTokens, getPromptTokens, getContextWindow } from './tokens.js'
import type { Compaction, FileAttachment, Message, Session, UserMessage } from './types.js'

/**
 * 上下文压缩：把当前分支开头的一段消息（保留最近一截原文）交给模型总结成结构化摘要，
 * 之后每次请求用摘要替换这一段，原始消息留在本地可查看、可撤销。
 */

/** 提示侧 token 达到窗口的这个比例时，发送前自动压缩 */
export const COMPACT_RATIO = 0.8
/** 压缩时保留的原文比例：最近这部分的 token 不超过窗口的这个比例 */
const RETAIN_RATIO = 0.18
/** 保留原文的绝对上限：窗口很大时按比例会留下十几万 token，压完等于没压 */
const MAX_RETAIN_TOKENS = 120_000
/** 但至少保留这么多 token 的原文，太短的会话压不出有价值的内容 */
const MIN_RETAIN_TOKENS = 8_000
/** 至少保留两条消息（一问一答） */
const MIN_RETAIN_MESSAGES = 2
/** 手动压缩固定保留最近两条问答（4 条消息） */
const MANUAL_RETAIN_MESSAGES = 4
/** 至少有两轮才值得压缩 */
const MIN_COVER_MESSAGES = 2
/** 系统提示与工具声明的固定开销 */
const REQUEST_OVERHEAD = 800
/** 单次摘要请求的输入上限（字符）；超过就分段总结再合并 */
const CHUNK_CHARS = 24_000
/** 分段数量上限，超出的部分只取靠后的片段 */
const MAX_CHUNKS = 16

const SUMMARY_SYSTEM = `你是一个对话压缩器。用户会给你一段聊天记录，你要把它压缩成一份结构化摘要，供同一场对话继续时作为背景使用。

硬性要求：
1. 只输出摘要本身。不要开场白，不要回应，不要评论记录内容。
2. 不得编造记录里没有的信息；记录中没有的细节不要补全，存疑的写"未确认"。
3. 代码、命令、路径、文件名、URL、数字、专有名词、人名逐字保留，不翻译、不改写、不缩写。
4. 使用与记录主要语言一致的语言。
5. 用 Markdown，严格按下面六个小标题组织；某一节确实没有内容就写"无"。总长 800–1500 字。

## 用户目标与背景
## 已确认的事实与结论
## 已完成的操作与产出
## 未决问题与下一步
## 用户明确提出的要求与偏好
## 必须逐字保留的内容`

const CHUNK_SYSTEM = `你是一个聊天记录压缩器。用户会给你同一段对话中的一个片段，请输出这个片段的要点，供后续合并成完整摘要。

硬性要求：
1. 只输出要点，不要开场白，不要评论。
2. 代码、命令、路径、文件名、URL、数字、专有名词逐字保留。
3. 用 Markdown 无序列表，不超过 600 字。`

/** 摘要接入正式请求时的引导语：让模型知道这是背景，而不是用户的新要求 */
const SUMMARY_LEAD_IN = `以下是当前对话此前内容的压缩摘要。更早的原始消息已经省略，但用户在本机仍可查看原文。继续对话时请把它当作已经发生过的背景：不要复述这份摘要，不要把它当成用户的新要求，也不要提及"摘要"这件事本身。`

/** 把摘要并入系统提示 */
export const withCompactionSummary = (system: string, summary: string) =>
  `${system}\n\n${SUMMARY_LEAD_IN}\n\n<conversation_summary>\n${summary.trim()}\n</conversation_summary>`

export type CompactionProgress = {
  phase: 'chunk' | 'summary'
  /** 已完成的段数 / 总段数 */
  done: number
  total: number
  /** 当前这一步已生成的字符数 */
  chars: number
}

export type CompactionPlan = {
  /** 要被摘要覆盖的消息 ID */
  coveredIds: string[]
  /** 保留原文的消息条数 */
  keptCount: number
  /** 被覆盖部分的 token 估算 */
  coveredTokens: number
}

const describeFiles = (files: FileAttachment[]) =>
  files.length > 0
    ? `（附件：${files.map((file) => `${file.isImage ? '图片' : '文件'} ${file.name}`).join('、')}）`
    : ''

/** 一段聊天记录里的单条消息；思考与工具结果不入摘要，只标注发生过 */
const toTranscriptEntry = (message: Message, index: number): string => {
  if (message.role === 'user') {
    const body = [message.content.trim(), describeFiles(message.files)].filter(Boolean).join('\n')
    return `#### ${index + 1}. 用户\n${body || '（空消息）'}`
  }
  const body = getReplyText(message).trim()
  const lines = [body || '（这一轮没有回答）']
  if (message.error) {
    lines.push(`（本轮失败：${message.error.message || '请求未成功'}）`)
  }
  const calls = message.blocks.filter((block) => block.type === 'server_tool_use').length
  if (calls > 0) {
    lines.push(`（本轮调用了 ${calls} 次联网工具，结果不计入摘要）`)
  }
  return `#### ${index + 1}. 助手\n${lines.join('\n')}`
}

/** 按消息边界把记录切成若干段，单段不超过 CHUNK_CHARS */
const chunkEntries = (entries: string[]): string[] => {
  const chunks: string[] = []
  let current = ''
  for (const entry of entries) {
    if (current && current.length + entry.length > CHUNK_CHARS) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${entry}` : entry
  }
  if (current) {
    chunks.push(current)
  }
  // 段数过多时只保留靠后的片段，避免摘要请求本身超限
  return chunks.length > MAX_CHUNKS ? chunks.slice(-MAX_CHUNKS) : chunks
}

const collectSummary = async (
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  onText?: (text: string) => void
): Promise<string> => {
  let text = ''
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
      onText?.(text)
    }
  }
  return text.trim()
}

/** 摘要请求：思考关闭、默认不声明任何工具（记录里的链接不需要真的去读） */
const requestSummary = async (
  apiKey: string,
  model: ChatModel,
  system: string,
  input: string,
  signal: AbortSignal,
  onText?: (text: string) => void
): Promise<string> => {
  const body: CreateMessageRequest = {
    model,
    system,
    messages: [{ role: 'user', content: input }],
    thinking: { type: 'disabled' },
    tools: [],
    safety_check: { level: 'high' },
  }
  let summary: string
  try {
    summary = await collectSummary(apiKey, body, signal, onText)
  } catch (error) {
    // 空工具声明被服务端拒绝时，带一个不会主动触发的阅读工具再试一次
    if (!(error instanceof ApiError) || error.status !== 400) {
      throw error
    }
    summary = await collectSummary(
      apiKey,
      { ...body, tools: [{ type: 'deepseek_read_url', name: 'deepseek_read_url' }] },
      signal,
      onText
    )
  }
  if (!summary) {
    throw new ApiError('protocol', 'summary is empty')
  }
  return summary
}

/**
 * 选出一段要被压缩的早期消息。
 * - 自动压缩：从末尾往前留够 RETAIN_RATIO 的原文，尽量不丢最近的上下文；
 * - 手动压缩：固定保留最近两轮问答，用户点了就压，不再按 token 余量判断；
 * - aggressive（超限抢救）：只留最后一轮，把能削的头部都削掉。
 * 保留段必须从提问开始，避免留下没有提问的孤立回答。
 */
export const planCompaction = (
  messages: Message[],
  window: number,
  { manual = false, aggressive = false }: { manual?: boolean; aggressive?: boolean } = {}
): CompactionPlan | null => {
  if (messages.length < MIN_COVER_MESSAGES + MIN_RETAIN_MESSAGES) {
    return null
  }
  let start: number
  if (aggressive) {
    start = Math.max(0, messages.length - MIN_RETAIN_MESSAGES)
  } else if (manual) {
    start = Math.max(0, messages.length - MANUAL_RETAIN_MESSAGES)
  } else {
    const retainTokens = Math.min(
      Math.max(Math.round(window * RETAIN_RATIO), MIN_RETAIN_TOKENS),
      MAX_RETAIN_TOKENS
    )
    start = messages.length
    let kept = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message) {
        continue
      }
      const cost = estimateMessageTokens(message)
      const keptCount = messages.length - index
      if (keptCount > MIN_RETAIN_MESSAGES && kept + cost > retainTokens) {
        break
      }
      kept += cost
      start = index
    }
  }
  // 保留段必须从提问开始，否则会留下没有提问的孤立回答
  let boundary = messages[start]
  while (boundary && boundary.role !== 'user') {
    start += 1
    boundary = messages[start]
  }
  if (start < MIN_COVER_MESSAGES || start >= messages.length) {
    return null
  }
  const covered = messages.slice(0, start)
  return {
    coveredIds: covered.map((message) => message.id),
    keptCount: messages.length - start,
    coveredTokens: covered.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
  }
}

/** 会话当前用的模型；没有记录时用默认模型 */
export const getSessionModel = (session: Session): ChatModel => {
  const visible = getVisibleMessages(session)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.model) {
      return message.model
    }
  }
  return 'deepseek-flash'
}

/** 服务端回报的真实模型名；旧消息没有这个记录时为 undefined */
export const getServedModel = (session: Session): string | undefined => {
  const visible = getVisibleMessages(session)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.servedModel) {
      return message.servedModel
    }
  }
  return undefined
}

/** 查容量时优先用服务端回报的真实模型，认不出再退回请求别名 */
const resolveWindow = (session: Session): number =>
  getContextWindow(getServedModel(session) ?? getSessionModel(session))

/** 一次请求的提示侧估算：进入请求的消息 + 固定开销（系统提示与工具声明） */
export const estimateRequestTokens = (messages: Message[], overhead = REQUEST_OVERHEAD) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0) + overhead

export type ContextUsage = {
  /** 下一次请求预计占用的提示侧 token */
  used: number
  /** 模型声明的上下文窗口 */
  window: number
  /** 0–100，超过上限时封顶 */
  percent: number
  /** 是否锚定了服务端真实用量；false 表示整体按字数估算 */
  measured: boolean
  /** 明细：对话消息与系统提示各占多少 */
  messageTokens: number
  systemTokens: number
  /** 当前是否处于压缩状态 */
  compacted: boolean
}

/**
 * 上下文占用：以最近一次服务端回报的真实用量为锚，加上对话表面的净增减，
 * 因此压缩后立即下降、撤销后立即回升——和「上一次请求用了多少」不是一回事。
 */
const measureContext = (
  session: Session,
  extra: Message[],
  systemBase: string
): ContextUsage | null => {
  const visible = getVisibleMessages(session)
  if (visible.length === 0 && extra.length === 0) {
    return null
  }
  const { history, summary } = applyCompaction(visible, session.compaction)
  const system = summary ? withCompactionSummary(systemBase, summary) : systemBase
  const rawSystem = estimateTokens(system)
  const rawMessages = estimateRequestTokens([...history, ...extra])
  const rawTotal = rawSystem + rawMessages
  let anchorUsage: number | undefined
  let anchorEstimate: number | undefined
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.usage) {
      anchorUsage = getPromptTokens(message.usage)
      anchorEstimate = message.promptEstimate
      break
    }
  }
  let used = rawTotal
  if (anchorUsage !== undefined && anchorEstimate !== undefined) {
    used = Math.max(0, anchorUsage + (rawTotal - anchorEstimate))
  }
  const measured = anchorUsage !== undefined && anchorEstimate !== undefined
  // 明细按比例归到真实用量上：否则估算出来的分解会比总数还大，看着像 bug
  const scale = rawTotal > 0 ? used / rawTotal : 1
  const window = resolveWindow(session)
  return {
    used: Math.round(used),
    window,
    percent: Math.min(100, Math.round((used / window) * 100)),
    measured,
    messageTokens: Math.round(rawMessages * scale),
    systemTokens: Math.round(rawSystem * scale),
    compacted: summary !== null,
  }
}

/** 当前分支下一次请求的上下文占用；空会话返回 null */
export const getContextUsage = (session: Session, systemBase = ''): ContextUsage | null =>
  measureContext(session, [], systemBase)

/** 带上待发提问后的提示侧 token，用于判断是否该自动压缩 */
export const estimatePromptTokens = (session: Session, question?: UserMessage): number =>
  measureContext(session, question ? [question] : [], '')?.used ?? 0

/** 是否需要自动压缩 */
export const needsCompaction = (session: Session, question?: UserMessage): boolean => {
  const window = resolveWindow(session)
  return (
    estimatePromptTokens(session, question) > window * COMPACT_RATIO &&
    planCompaction(getVisibleMessages(session), window) !== null
  )
}

/**
 * 请求里只有「被覆盖消息组成的开头连续前缀」才用摘要替换；
 * 分支切换后覆盖段可能不再连续或已不在当前分支上，这时忽略这次压缩（原文照常回传）。
 */
export const applyCompaction = (
  history: Message[],
  compaction?: Compaction
): { history: Message[]; summary: string | null } => {
  if (!compaction || compaction.coveredIds.length === 0) {
    return { history, summary: null }
  }
  const covered = new Set(compaction.coveredIds)
  let cut = 0
  while (cut < history.length) {
    const message = history[cut]
    if (!message || !covered.has(message.id)) {
      break
    }
    cut += 1
  }
  if (cut === 0 || history.slice(cut).some((message) => covered.has(message.id))) {
    return { history, summary: null }
  }
  return { history: history.slice(cut), summary: compaction.summary }
}

/** 界面上需要隐藏的开头消息条数；覆盖段失效时返回 0，全部照常展示 */
export const getCoveredCount = (messages: Message[], compaction?: Compaction): number => {
  const covered = compaction ? new Set(compaction.coveredIds) : null
  if (!covered || covered.size === 0) {
    return 0
  }
  let cut = 0
  while (cut < messages.length) {
    const message = messages[cut]
    if (!message || !covered.has(message.id)) {
      break
    }
    cut += 1
  }
  return messages.slice(cut).some((message) => covered.has(message.id)) ? 0 : cut
}

/** 服务端判定超出上下文长度时返回 true，用于压缩后重试一次 */
/**
 * 服务端判定超出上下文长度时返回 true，用于压缩后重试。
 * 措辞各版本不一样，所以按关键词表匹配；状态码只认常见的几个，避免把权限、参数错误也当成超限。
 */
const OVERFLOW_STATUSES = new Set([400, 413, 422, 500, 529])
const OVERFLOW_PATTERN =
  /context|token|too long|too large|too many|maximum|exceed|over limit|reduce the length|prompt is too|input is too|输入|长度|过长|超长|超出|超过|上限|太大|过长/i

export const isContextOverflowError = (error: unknown): boolean => {
  if (!(error instanceof ApiError) || error.kind !== 'http') {
    return false
  }
  if (error.status === undefined || !OVERFLOW_STATUSES.has(error.status)) {
    return false
  }
  return OVERFLOW_PATTERN.test(error.message)
}

/** 已有摘要时追加的合并要求：不照抄、不丢仍然成立的事实 */
const MERGE_SYSTEM = `${SUMMARY_SYSTEM}

6. 输入里可能包含一份"既有摘要"，它是更早对话的唯一记录。请把它当作已发生过的历史：保留其中仍然成立的事实与结论，丢弃已经过时的内容，再与新增的记录合并成一份完整摘要。不要逐字照抄既有摘要，也不要提及"既有摘要"这件事本身。`

/** 判断旧压缩记录是否仍然覆盖在新范围的开头，是的话可以只处理新增部分 */
const continuesFrom = (previous: Compaction, covered: Message[]): boolean =>
  previous.coveredIds.length > 0 &&
  previous.summary.trim() !== '' &&
  previous.coveredIds.length < covered.length &&
  previous.coveredIds.every((id, index) => covered[index]?.id === id)

/** 压缩结果：要么给出记录，要么说明为什么没压 */
export type CompactionOutcome =
  | { ok: true; compaction: Compaction }
  /** empty：消息还不够；no-gain：压完省不下上下文（摘要比被吞掉的原文还长） */
  | { ok: false; reason: 'empty' | 'no-gain' }

/** 允许的估算误差：缩小不到 5% 就当作没收益 */
const NO_GAIN_RATIO = 0.05

/**
 * 生成一份压缩记录：先按消息边界分段（必要时逐段总结），最后合成结构化摘要。
 * 已经压缩过、且旧覆盖段仍然成立时，只把「旧摘要 + 上次裁剪点之后的新增」交给模型合并，
 * 不再重发早已被摘要掉的原文。压完没有变小则作废，不覆盖现有记录。
 */
export const buildCompaction = async ({
  session,
  apiKey,
  model,
  mode,
  signal,
  aggressive = false,
  window = resolveWindow(session),
  onProgress,
}: {
  session: Session
  apiKey: string
  model: ChatModel
  mode: Compaction['mode']
  signal: AbortSignal
  /** 超限抢救：只留最后一轮原文，尽量削掉头部 */
  aggressive?: boolean
  window?: number
  onProgress?: (progress: CompactionProgress) => void
}): Promise<CompactionOutcome> => {
  const visible = getVisibleMessages(session)
  const plan = planCompaction(visible, window, { manual: mode === 'manual', aggressive })
  if (!plan) {
    return { ok: false, reason: 'empty' }
  }
  const covered = visible.slice(0, plan.coveredIds.length)
  // 能接着上次压：只总结「旧摘要 + 上次之后新增的原文」
  const previous = session.compaction
  const merge = previous !== undefined && continuesFrom(previous, covered)
  const fresh = merge ? covered.slice(previous.coveredIds.length) : covered
  const entries = fresh.map((message, index) =>
    toTranscriptEntry(message, merge ? index + previous.coveredIds.length : index)
  )
  const head =
    merge && previous
      ? `#### 既有摘要（更早的对话）\n${previous.summary.trim()}`
      : null
  const chunks = chunkEntries(head === null ? entries : [head, ...entries])
  let input: string
  if (chunks.length <= 1) {
    input = merge
      ? `下面是上一份摘要，以及它之后新增的聊天记录：\n\n${[head, ...entries].join('\n\n')}`
      : `下面是需要压缩的聊天记录：\n\n${entries.join('\n\n')}`
  } else {
    const notes: string[] = []
    for (const [index, chunk] of chunks.entries()) {
      signal.throwIfAborted()
      const note = await requestSummary(
        apiKey,
        model,
        CHUNK_SYSTEM,
        `这是同一段对话的第 ${index + 1}/${chunks.length} 部分（按时间顺序）：\n\n${chunk}`,
        signal,
        (text) =>
          onProgress?.({ phase: 'chunk', done: index, total: chunks.length, chars: text.length })
      )
      notes.push(`### 第 ${index + 1} 段\n${note}`)
    }
    input = `下面是同一段对话按时间顺序排列的分段要点：\n\n${notes.join('\n\n')}\n\n请据此写出最终摘要。`
  }
  signal.throwIfAborted()
  const summary = await requestSummary(
    apiKey,
    model,
    merge ? MERGE_SYSTEM : SUMMARY_SYSTEM,
    input,
    signal,
    (text) =>
      onProgress?.({ phase: 'summary', done: chunks.length, total: chunks.length, chars: text.length })
  )
  const beforeTokens = estimatePromptTokens(session)
  // 压缩后 = 现状 - 这次新吞掉的原文 + 新摘要 - 被替换掉的旧摘要
  const freshTokens = fresh.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  const afterTokens = Math.max(
    0,
    beforeTokens -
      freshTokens +
      estimateTokens(summary) -
      (merge && previous ? estimateTokens(previous.summary) : 0)
  )
  // 摘要没比被吞掉的原文短，等于白花一次钱：作废，不改动现有记录
  if (afterTokens >= beforeTokens * (1 - NO_GAIN_RATIO)) {
    return { ok: false, reason: 'no-gain' }
  }
  return {
    ok: true,
    compaction: {
      summary,
      coveredIds: plan.coveredIds,
      createdAt: Date.now(),
      mode,
      beforeTokens,
      afterTokens,
      model,
    },
  }
}
