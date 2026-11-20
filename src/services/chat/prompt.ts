import type { CreateMessageRequest } from '../api/types.js'

/**
 * 请求的固定外围：聊天与摘要共用同一份，摘要请求才能命中聊天的前缀缓存。
 */

/** 所有生成请求统一携带的助手身份说明 */
export const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
export const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 安全审核固定开启，所有请求都走扩展模式 */
export const SAFETY_CHECK = { level: 'high' } as const
