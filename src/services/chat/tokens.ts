import type { MessageUsage } from '../api/types.js'
import { DEFAULT_CONTEXT_WINDOW, useSettings } from '../settings.js'
import type { Message } from './types.js'

/**
 * 上下文用量口径。真实用量来自每轮回复的 usage（服务端返回），
 * 只有还没发过请求的提问、以及历史导入的旧消息才需要按字数估算。
 */

/** 各模型声明的上下文窗口；deepseek-flash 当前解析到 DeepSeek-V4.1-Flash，官方 /models 声明 1Mi */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-flash': 1_048_576,
  'deepseek-v4-pro': 1_048_576,
}

/** 图片经 Files API 展开成视觉 token；按偏大估，宁可提前压缩 */
const IMAGE_TOKENS = 1_500
/** 文档按解析后的文本量差异很大，取一个保守的均价 */
const DOCUMENT_TOKENS = 2_000
/** 阅读链接的页面正文会随签名一起回传，按每处留一点余量 */
const READ_LINK_TOKENS = 800

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
    const files = message.files.reduce(
      (sum, file) => sum + (file.isImage ? IMAGE_TOKENS : DOCUMENT_TOKENS),
      0
    )
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
 * 上下文窗口：优先用模型自己声明的容量，认不出的模型退回设置里的值。
 * 模型容量来自服务端 /models 的声明，改别名时这张表要跟着改。
 */
export const getContextWindow = (model?: string | null): number => {
  const declared = model ? MODEL_CONTEXT_WINDOWS[model] : undefined
  if (declared) {
    return declared
  }
  const value = useSettings.getState().contextWindow
  return value > 0 ? value : DEFAULT_CONTEXT_WINDOW
}
