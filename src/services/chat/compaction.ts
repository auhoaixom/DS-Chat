import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest, MessageUsage } from '../api/types.js'
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
 * - 手动压缩：固定保留最近两轮问答，用户点了就压，不再按 token 余量判断。
 * 保留段必须从提问开始，避免留下没有提问的孤立回答。
 */
export const planCompaction = (
  messages: Message[],
  window: number,
  { manual = false }: { manual?: boolean } = {}
): CompactionPlan | null => {
  if (messages.length < MIN_COVER_MESSAGES + MIN_RETAIN_MESSAGES) {
    return null
  }
  let start: number
  if (manual) {
    start = Math.max(0, messages.length - MANUAL_RETAIN_MESSAGES)
  } else {
    const retainTokens = Math.max(Math.round(window * RETAIN_RATIO), MIN_RETAIN_TOKENS)
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

/** 当前分支的提示侧 token 估算：最近一次真实用量 + 之后新增消息的估算 */
export const estimatePromptTokens = (session: Session, question?: UserMessage): number => {
  const visible = getVisibleMessages(session)
  let anchor = -1
  let anchorUsage: MessageUsage | undefined
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message?.role === 'assistant' && message.usage) {
      anchor = index
      anchorUsage = message.usage
      break
    }
  }
  let tokens = anchor >= 0 ? getPromptTokens(anchorUsage) : 0
  for (const message of visible.slice(anchor + 1)) {
    tokens += estimateMessageTokens(message)
  }
  if (question) {
    tokens += estimateMessageTokens(question)
  }
  return tokens + REQUEST_OVERHEAD
}

/** 是否需要自动压缩 */
export const needsCompaction = (
  session: Session,
  question?: UserMessage,
  window = getContextWindow()
): boolean =>
  estimatePromptTokens(session, question) > window * COMPACT_RATIO &&
  planCompaction(getVisibleMessages(session), window) !== null

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
export const isContextOverflowError = (error: unknown): boolean => {
  if (!(error instanceof ApiError) || error.kind !== 'http') {
    return false
  }
  if (error.status !== 400 && error.status !== 413) {
    return false
  }
  return /context|token|length|too long|maximum|prompt|输入|长度|过长|超长/i.test(error.message)
}

/**
 * 生成一份压缩记录：先按消息边界分段（必要时逐段总结），最后合成结构化摘要。
 * 返回 null 表示这段对话不值得压缩（消息太少）。
 */
export const buildCompaction = async ({
  session,
  apiKey,
  model,
  mode,
  signal,
  window = getContextWindow(),
  onProgress,
}: {
  session: Session
  apiKey: string
  model: ChatModel
  mode: Compaction['mode']
  signal: AbortSignal
  window?: number
  onProgress?: (progress: CompactionProgress) => void
}): Promise<Compaction | null> => {
  const visible = getVisibleMessages(session)
  const plan = planCompaction(visible, window, { manual: mode === 'manual' })
  if (!plan) {
    return null
  }
  const covered = visible.slice(0, plan.coveredIds.length)
  const entries = covered.map(toTranscriptEntry)
  const chunks = chunkEntries(entries)
  let input: string
  if (chunks.length <= 1) {
    input = `下面是需要压缩的聊天记录：\n\n${entries.join('\n\n')}`
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
  const summary = await requestSummary(apiKey, model, SUMMARY_SYSTEM, input, signal, (text) =>
    onProgress?.({ phase: 'summary', done: chunks.length, total: chunks.length, chars: text.length })
  )
  const beforeTokens = estimatePromptTokens(session)
  return {
    summary,
    coveredIds: plan.coveredIds,
    createdAt: Date.now(),
    mode,
    beforeTokens,
    afterTokens: Math.max(0, beforeTokens - plan.coveredTokens + estimateTokens(summary)),
    model,
  }
}
