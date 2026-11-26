import type { MessageUsage } from '../api/types.js'
import { DEFAULT_CONTEXT_WINDOW } from '../settings.js'
import { fileTokensOf } from './fileTokens.js'
import type { Message } from './types.js'

/**
 * 上下文用量口径。真实用量来自每轮回复的 usage（服务端返回），
 * 只有还没发过请求的提问、以及历史导入的旧消息才需要按字数估算。
 */

/** 各模型声明的上下文窗口；deepseek-flash 当前解析到 DeepSeek-V4.1-Flash，官方 /models 声明 1Mi */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-flash': 1_048_576,
  'deepseek-v4-pro': 1_048_576,
  // 服务端回报的真实模型名，别名换了也能对上
  'deepseek-v4.1-flash': 1_048_576,
  'deepseek-v4.1-pro': 1_048_576,
}

/**
 * 估算口径的版本号。
 *
 * 消息里存的 `promptEstimate` 是「当时那把尺子」量出来的，锚点再用它去算表面净增减。
 * 尺子一改，历史记录里的数就和现在不是一个单位了，差出来的不是对话变多变少，而是口径漂移
 * ——所以锚点必须连它一起认，版本对不上就当一个都没有，退回收纯估算。
 *
 * 什么时候 +1（改任何一项都要）：
 * - `estimateTokens` 的 0.75 / 0.32 两个系数
 * - `READ_LINK_TOKENS` 占位值
 * - `compaction.ts` 的 `REQUEST_OVERHEAD`
 * - `fileTokens.ts` 的 `IMAGE_TOKENS` / `DOCUMENT_TOKENS` 占位值，或附件真值的取值方式
 */
export const ESTIMATE_VERSION = 2

/**
 * 抓取结果块的固定开销。页面正文加密在 signature 里、`content.source.data` 是空串，
 * 请求只带一个不透明的签名，服务端不按页面长度计费。
 *
 * 实测（2026-11，Rust 会话）：42 个抓取块，整个请求服务端只算 11145 token，
 * 而正文本身的估算就有 12480，说明每块的真实成本只有几十 token 的量级。
 * 旧的 800/块让这个会话的估算虚高到 47372（占 71%），进度环和压缩阈值全被带偏。
 * 取 60：仍是实测上界的保守值，但不再是凭空多出来的三万。
 */
const READ_LINK_TOKENS = 60

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uff60]/

/**
 * 按字符类型估算 token：中文约 1 字 1 token，ASCII 约 3.3 字符 1 token，
 * 都取偏大的系数，避免自动压缩迟迟不触发然后撞上服务端上限。
 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (CJK.test(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return Math.ceil(cjk * 0.75 + other * 0.32)
}

/** 单条消息进入请求后的 token 估算 */
export const estimateMessageTokens = (message: Message): number => {
  if (message.role === 'user') {
    // 附件单价问 fileTokens：拿得到服务端真值（图片）或反推值（文档）就用它，
    // 拿不到才退回占位值——占位值本身由 fileTokens.ts 管，别在这里再写一份
    const files = message.files.reduce((sum, file) => sum + fileTokensOf(file), 0)
    return estimateTokens(message.content) + files + 8
  }
  let tokens = 8
  for (const block of message.blocks) {
    if (block.type === 'text') {
      tokens += estimateTokens(block.text)
    } else if (block.type === 'web_fetch_tool_result') {
      tokens += READ_LINK_TOKENS
    }
  }
  return tokens
}

/** 一轮请求的提示侧 token：输入 + 缓存写入 + 缓存命中（不含输出） */
export const getPromptTokens = (usage?: MessageUsage): number =>
  usage
    ? usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    : 0

/** 1.2K / 48K / 1.0M 这样的紧凑显示 */
export const formatTokens = (tokens: number): string => {
  if (tokens < 1_000) {
    return String(Math.max(0, Math.round(tokens)))
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  const value = tokens / 1_000
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}K`
}

/**
 * 只给用量面板用的粗显示：一律以 K 为单位，不给具体 token 数。
 * K 按 1024 计，和窗口声明的 1024K 同一把尺子；不足 1K 一格统称 <1K。
 * 诊断信息不用这个函数——那里要看精确值才能排查。
 */
export const formatTokensK = (tokens: number): string => {
  if (!(tokens >= 1024)) {
    return '<1K'
  }
  const value = tokens / 1024
  return value < 10 ? `${value.toFixed(1)}K` : `${Math.round(value)}K`
}

/**
 * 上下文窗口：一律用模型自己声明的容量。
 * 模型容量来自服务端 /models 的声明，改别名时这张表要跟着改；
 * 认不出的模型退回 1Mi，而不是退回某个用户选过的数字。
 */
export const getContextWindow = (model?: string | null): number =>
  (model ? MODEL_CONTEXT_WINDOWS[model] : undefined) ?? DEFAULT_CONTEXT_WINDOW
