import type { CreateMessageRequest, SafetyCheck } from '../api/types.js'
import { supportsServerFeatures } from './capabilities.js'

/**
 * 请求的固定外围：聊天与摘要共用同一份，摘要请求才能命中聊天的前缀缓存。
 */

/** 所有生成请求统一携带的助手身份说明 */
export const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/**
 * 系统提示词的版本号。**改了 `SYSTEM_PROMPT` 就要 +1。**
 * 每次请求的固定开销变了，服务端实测的提示侧 token 就和历史回复不是一回事了，
 * 锚点（见 compaction.ts 的 requestKey）靠它判定要不要继续复用。
 * 工具声明不单独计版本：它由模型能力与搜索开关决定，这两个已经在 requestKey 里了。
 */
export const SYSTEM_PROMPT_VERSION = 1

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
export const serverTools = (model: string, search: boolean): CreateMessageRequest['tools'] => {
  if (!supportsServerFeatures(model)) {
    return []
  }
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/**
 * 安全审核：默认**不声明**该字段（与 level: 'low' 等价，都是 API 默认检查）。
 *
 * 声明 level: 'high' 会把每次请求推进"基础风控"，额外付出三样东西：
 * 输出写完后服务端要再审一遍才关连接、抓回来的网页要先过审才下发（未通过的
 * 页面按 url_not_allowed 计费照收）、审核本身的 token 计入 output_tokens。
 * 自用场景不需要这一层；要开只改这一行，三个注入点会跟着带上。
 *
 * 注意：关掉它不等于没有拒答——声明了联网工具的请求即使不传 safety_check，
 * 也可能以 stop_reason: 'refusal' 结束，拒答分支必须一直留着。
 */
export const SAFETY_CHECK: SafetyCheck | undefined = undefined

/** 请求体里的安全审核字段；未开启时整个字段都不出现 */
export const safetyCheckField = (): { safety_check?: SafetyCheck } =>
  SAFETY_CHECK ? { safety_check: SAFETY_CHECK } : {}
