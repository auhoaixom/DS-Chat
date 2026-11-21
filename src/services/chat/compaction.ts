import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest, MessageUsage } from '../api/types.js'
import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import { SAFETY_CHECK, SYSTEM_PROMPT, serverTools } from './prompt.js'
import { getReplyText, toHistoryParams } from './reply.js'
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
/**
 * 请求的固定开销：那句系统提示词、工具声明（read_url / web_search）、协议外壳。
 *
 * 以前取 800，把每一次短请求都估成十几倍大：一轮"82374919*61525321"的对话里
 * 服务端实测 in = 64，我们估 828，于是上下文环、明细拆分、自动压缩阈值全被带偏
 * （锚定后按比例摊回去，"系统提示词"只剩 1）。
 * 实测（2026-11，Redmi 14C）：17 个 ASCII 字符的一条消息，服务端整份提示侧 64 token，
 * 扣掉正文与消息包装约 14，固定开销在 50 上下。取 56 留一点余量。
 */
const REQUEST_OVERHEAD = 56
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

/** 收集摘要正文，同时记下这次摘要请求自己的用量（用于核对缓存命中） */
const collectSummary = async (
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  onText?: (text: string) => void
): Promise<{ text: string; usage?: MessageUsage }> => {
  let text = ''
  let usage: MessageUsage | undefined
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'message_start') {
      usage = event.message.usage ?? usage
    } else if (event.type === 'message_delta') {
      usage = event.usage ?? usage
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
      onText?.(text)
    }
  }
  return { text: text.trim(), usage }
}

/** 摘要请求：思考关闭、默认不声明任何工具（记录里的链接不需要真的去读） */
const requestSummary = async (
  apiKey: string,
  model: ChatModel,
  system: string,
  input: string,
  signal: AbortSignal,
  onText?: (text: string) => void
): Promise<SummarizeResult> => {
  const body: CreateMessageRequest = {
    model,
    system,
    messages: [{ role: 'user', content: input }],
    thinking: { type: 'disabled' },
    tools: [],
    safety_check: SAFETY_CHECK,
  }
  let result: SummarizeResult
  try {
    result = await collectSummary(apiKey, body, signal, onText)
  } catch (error) {
    // 空工具声明被服务端拒绝时，带一个不会主动触发的阅读工具再试一次
    if (!(error instanceof ApiError) || error.status !== 400) {
      throw error
    }
    result = await collectSummary(apiKey, { ...body, tools: serverTools(false) }, signal, onText)
  }
  if (!result.text) {
    throw new ApiError('protocol', 'summary is empty')
  }
  return result
}

/** 一次摘要请求的产物：正文与服务端回报的用量（用量用于核对缓存是否命中） */
type SummarizeResult = { text: string; usage?: MessageUsage }

/**
 * 回放式摘要（只对纯文字会话启用）：把被压缩的那段历史按**聊天时的原样**发出去，
 * 只在末尾追加一条压缩指令——前缀与上一轮真实请求逐字一致，服务端缓存才能命中。
 */
const requestReplaySummary = async (
  apiKey: string,
  model: ChatModel,
  history: Message[],
  search: boolean,
  signal: AbortSignal,
  onText?: (text: string) => void
): Promise<SummarizeResult> => {
  const body: CreateMessageRequest = {
    model,
    system: SYSTEM_PROMPT,
    messages: [...toHistoryParams(history), { role: 'user', content: REPLAY_INSTRUCTION }],
    thinking: { type: 'disabled' },
    tools: serverTools(search),
    safety_check: SAFETY_CHECK,
  }
  const result = await collectSummary(apiKey, body, signal, onText)
  if (!result.text) {
    throw new ApiError('protocol', 'summary is empty')
  }
  return result
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

/** 会话当前用的模型；没有记录时用设置里的模型 */
export const getSessionModel = (session: Session): ChatModel => {
  const visible = getVisibleMessages(session)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.model) {
      return message.model
    }
  }
  return useSettings.getState().model
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

/**
 * 锚点状态：measured 用了服务端实测；estimate 一直没等到用量；
 * dropped 等到了但被判不可信（用例见 plausibleAnchor）
 */
export type AnchorState = 'measured' | 'estimate' | 'dropped'

/** 丢弃锚点的原因：compaction 压缩后旧锚点失效；usage 服务端用量不合常理 */
export type AnchorDropReason = 'compaction' | 'usage'

export type ContextUsage = {
  /** 下一次请求预计占用的提示侧 token */
  used: number
  /** 模型声明的上下文窗口 */
  window: number
  /** 0–100，超过上限时封顶 */
  percent: number
  /** 是否锚定了服务端真实用量；false 表示整体按字数估算 */
  measured: boolean
  /** 明细三项，按同一系数归一后相加正好等于 used（不含请求开销重复计数） */
  messageTokens: number
  systemTokens: number
  /** 请求本身的固定开销（协议外壳、工具声明），单列出来免得被当成对话内容 */
  overheadTokens: number
  /** 当前是否处于压缩状态 */
  compacted: boolean
  anchor: AnchorState
  /** 锚点被丢弃的原因；anchor 不是 dropped 时为 null */
  anchorDropReason: AnchorDropReason | null
  /** 诊断用：被判定的锚点实测值与当时的估算值，没有锚点时为 null */
  anchorUsed: number | null
  anchorEstimate: number | null
}

/**
 * 锚点是否可信。唯一的硬条件是「提示侧用量得是个像样的数」：服务端有时只回输出侧的
 * 计数，input + 缓存读 + 缓存写 全是 0。把它当成实测，整个上下文会被压成几十 token
 * ——进度环一直不到 1%、自动压缩永远不触发，直到发送撞上服务端上限才暴露。
 * 宁可退回纯估算：那只是偏大，不会漏压。
 *
 * 不拿「实测 / 估算」的比值当判据：估算本身就会偏大（短请求尤其明显），
 * 比值小是常态，用它筛只会把好好的锚点一起丢掉。
 */
const MIN_ANCHOR_TOKENS = 32

const plausibleAnchor = (usage: number): boolean => usage >= MIN_ANCHOR_TOKENS

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
  let anchorCreatedAt = 0
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.usage) {
      anchorUsage = getPromptTokens(message.usage)
      anchorEstimate = message.promptEstimate
      anchorCreatedAt = message.createdAt
      break
    }
  }
  /**
   * 压缩之后的锚点不再可信：实测值和服务端口径、估算值和我们自己的字数口径，
   * 本来就是两把尺子，靠"表面净增减"把误差抵消掉。压缩一次就抹掉上万 token，
   * 这个巨大负增量会把两把尺子的偏差直接放大到看得见（夹成 0/1.0M）。
   * 所以压缩之后退回纯估算，等下一次回复重新锚定。
   */
  let dropReason: AnchorDropReason | null = null
  if (session.compaction && anchorCreatedAt < session.compaction.createdAt) {
    dropReason = 'compaction'
  } else if (anchorUsage !== undefined && !plausibleAnchor(anchorUsage)) {
    dropReason = 'usage'
  }
  const anchorUsed = anchorUsage ?? null
  const anchorEstimateValue = anchorEstimate ?? null
  if (dropReason !== null) {
    anchorUsage = undefined
    anchorEstimate = undefined
  }
  let used = rawTotal
  if (anchorUsage !== undefined && anchorEstimate !== undefined) {
    /**
     * 净增减只认正数：锚点之后的对话只会变长，估算变短只可能是估算口径改过
     * （比如固定开销从 800 调到 56）或消息被删。这时宁可停在实测值上，
     * 也不能让差值把总量拉成 0——那会让进度环凭空归零。
     */
    used = anchorUsage + Math.max(0, rawTotal - anchorEstimate)
  }
  const measured = anchorUsage !== undefined && anchorEstimate !== undefined
  const anchor: AnchorState = measured ? 'measured' : dropReason === null ? 'estimate' : 'dropped'
  // 明细按比例归到真实用量上：否则估算出来的分解会比总数还大，看着像 bug
  const scale = rawTotal > 0 ? used / rawTotal : 1
  const window = resolveWindow(session)
  const systemTokens = Math.round(rawSystem * scale)
  const overheadTokens = Math.round(REQUEST_OVERHEAD * scale)
  return {
    used: Math.round(used),
    window,
    percent: Math.min(100, Math.round((used / window) * 100)),
    measured,
    // 余数归给对话消息，保证三项相加正好等于 used，不会因为各自四舍五入差几个 token
    messageTokens: Math.max(0, Math.round(used) - systemTokens - overheadTokens),
    systemTokens,
    overheadTokens,
    compacted: summary !== null,
    anchor,
    anchorDropReason: dropReason,
    anchorUsed,
    anchorEstimate: anchorEstimateValue,
  }
}

/** 当前分支下一次请求的上下文占用；空会话返回 null */
export const getContextUsage = (session: Session, systemBase = ''): ContextUsage | null =>
  measureContext(session, [], systemBase)

/** 一场对话的累计缓存命中情况（只看带服务端用量的回答） */
export type CacheStats = {
  /** 命中率百分比 */
  percent: number
  /** 参与统计的请求数 */
  requests: number
  /** 命中的 token 与提示侧总量，用于诊断 */
  read: number
  total: number
}

/**
 * 累计命中率：把当前分支上每个回答的提示侧用量加起来，
 * 用「命中 / 全部」表示这场对话有多少输入是按缓存价计费的。
 * 压缩会让下一次请求必然全价，但它只是一次请求，累计值只会被摊薄一点。
 */
export const getCacheStats = (session: Session): CacheStats | null => {
  let read = 0
  let total = 0
  let requests = 0
  for (const message of getVisibleMessages(session)) {
    if (message.role !== 'assistant' || !message.usage) {
      continue
    }
    const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } = message.usage
    const prompt = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
    if (prompt <= 0) {
      continue
    }
    read += cache_read_input_tokens
    total += prompt
    requests += 1
  }
  if (requests === 0 || total <= 0) {
    return null
  }
  return { percent: Math.round((read / total) * 100), requests, read, total }
}

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

/**
 * 回放式摘要的末尾指令：前缀必须保持原样，所以压缩要求只能放在这里，
 * 且要明确禁止模型"接着回答"而不是"总结"。
 */
const REPLAY_INSTRUCTION = `以上是对话的全部内容。现在请你**只做一件事**：把这段对话压缩成一份结构化摘要，供同一场对话继续时作为背景使用。

硬性要求：
1. 只输出摘要本身。不要回答上面任何一个问题，不要接着对话，不要评论，不要开场白。
2. 不得编造对话里没有的信息；记录中没有的细节不要补全，存疑的写"未确认"。
3. 代码、命令、路径、文件名、URL、数字、专有名词、人名逐字保留，不翻译、不改写、不缩写。
4. 使用与对话主要语言一致的语言。
5. 用 Markdown，严格按下面六个小标题组织；某一节确实没有内容就写"无"。总长 800–1500 字。

## 用户目标与背景
## 已确认的事实与结论
## 已完成的操作与产出
## 未决问题与下一步
## 用户明确提出的要求与偏好
## 必须逐字保留的内容`

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

/** 摘要没比被替换掉的原文短，等于白花一次钱：作废，不改动现有记录 */
export const hasGain = (beforeTokens: number, afterTokens: number): boolean =>
  afterTokens < beforeTokens * (1 - NO_GAIN_RATIO)

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
  /**
   * 回放式摘要的启用条件：
   * - 没有旧摘要（增量合并的原料是摘要文本，回放无从对齐）；
   * - 被压缩的这段里没有用户附件（回放会让服务端真的去解析 file_id，风险与费用都不可控）；
   * - 一次性发得下（不分段，分段会打乱前缀）。
   */
  const textOnly = covered.every(
    (message) => message.role !== 'user' || message.files.length === 0
  )
  const coveredTokens = covered.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  const replayable = !merge && textOnly && coveredTokens < window * 0.5
  let result: SummarizeResult
  if (replayable) {
    const lastReply = [...visible]
      .reverse()
      .find((message) => message.role === 'assistant' && message.search !== undefined)
    result = await requestReplaySummary(
      apiKey,
      model,
      covered,
      lastReply?.role === 'assistant' ? (lastReply.search ?? false) : false,
      signal,
      (text) =>
        onProgress?.({ phase: 'summary', done: 0, total: 1, chars: text.length })
    )
  } else {
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
        notes.push(`### 第 ${index + 1} 段\n${note.text}`)
      }
      input = `下面是同一段对话按时间顺序排列的分段要点：\n\n${notes.join('\n\n')}\n\n请据此写出最终摘要。`
    }
    signal.throwIfAborted()
    result = await requestSummary(
      apiKey,
      model,
      merge ? MERGE_SYSTEM : SUMMARY_SYSTEM,
      input,
      signal,
      (text) =>
        onProgress?.({ phase: 'summary', done: chunks.length, total: chunks.length, chars: text.length })
    )
  }
  const summary = result.text
  // 诊断留痕：核对摘要请求是否吃到前缀缓存（真机可读 logcat 的 chromium 控制台）
  // eslint-disable-next-line no-console
  console.info(
    `[compaction] replay=${replayable} input=${result.usage?.input_tokens ?? -1} cacheRead=${
      result.usage?.cache_read_input_tokens ?? -1
    } cacheWrite=${result.usage?.cache_creation_input_tokens ?? -1} out=${
      result.usage?.output_tokens ?? -1
    }`
  )
  // 只丈量这次真正被替换掉的东西：被吞掉的原文（合并时再加上旧摘要）换成新摘要。
  // 两边都走同一套字数估算，不和进度环的实测值混着算——混着算时 after 会被夹成 0，
  // 卡片会把「全都省掉了」写在脸上，下面的 no-gain 判据也会失效。
  const freshTokens = fresh.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  const beforeTokens = freshTokens + (merge && previous ? estimateTokens(previous.summary) : 0)
  const afterTokens = estimateTokens(summary)
  // 摘要没比被替换掉的原文短，等于白花一次钱：作废，不改动现有记录
  if (!hasGain(beforeTokens, afterTokens)) {
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
      viaReplay: replayable,
      summaryUsage: result.usage
        ? {
            input: result.usage.input_tokens,
            cacheRead: result.usage.cache_read_input_tokens,
            cacheWrite: result.usage.cache_creation_input_tokens,
          }
        : undefined,
    },
  }
}
