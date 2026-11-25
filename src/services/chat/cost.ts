import { costOfUsage, isPeak, priceFor, tierAt, type UsageForCost } from './pricing.js'
import type { AssistantMessage, Message, RequestCost, Session } from './types.js'

/**
 * 把一次请求的用量换成一条成本记录；认不出价格或没有用量时返回 null。
 *
 * 单价随记录一起存下来，所以之后改价目表不会改写这一笔。
 */
export const requestCost = (
  usage: UsageForCost,
  at: number,
  model: string | null,
  servedModel?: string
): RequestCost | null => {
  const price = priceFor(model, servedModel)
  if (!price) {
    return null
  }
  const priced = costOfUsage(usage, tierAt(price, at))
  const tokens = priced.input + priced.cacheRead + priced.cacheWrite + priced.output
  if (tokens <= 0) {
    // 服务端没给用量（例如请求中途断开），没有可记的东西
    return null
  }
  return {
    at,
    peak: isPeak(at),
    model: servedModel || model || '',
    input: priced.input,
    cacheRead: priced.cacheRead,
    cacheWrite: priced.cacheWrite,
    output: priced.output,
    rates: priced.rates,
    nano: priced.nano,
  }
}

/**
 * 记账：把一次请求的用量追加到回复上。
 *
 * 只在请求真正发出、并拿到服务端 usage 之后调用一次。续写与断线自动续写各自算一笔，
 * 所以是同一条回复上追加，而不是覆盖。
 */
export const accrueCost = (
  reply: AssistantMessage,
  usage: UsageForCost,
  at: number
): AssistantMessage => {
  const cost = requestCost(usage, at, reply.model, reply.servedModel)
  return cost === null ? reply : { ...reply, costs: [...(reply.costs ?? []), cost] }
}

/** 这条回复花了多少（纳元） */
export const messageCostNano = (message: AssistantMessage): number =>
  (message.costs ?? []).reduce((sum, cost) => sum + cost.nano, 0)

/** 这条回复的计价档位：全峰、全谷，或跨过时段边界的混合 */
export type CostTier = 'peak' | 'off' | 'mixed'

export const messageTier = (message: AssistantMessage): CostTier | null => {
  const costs = message.costs ?? []
  if (costs.length === 0) {
    return null
  }
  if (costs.every((cost) => cost.peak)) {
    return 'peak'
  }
  return costs.every((cost) => !cost.peak) ? 'off' : 'mixed'
}

const isAssistant = (message: Message): message is AssistantMessage => message.role === 'assistant'

export type SessionCost = {
  /** 本会话已计价请求的合计，纳元；含不属于任何一条回复的开销 */
  nano: number
  /** 有成本记录的回复条数 */
  priced: number
  /** 没有成本记录的回复条数（导入的历史、旧版本留下的消息） */
  unpriced: number
}

/**
 * 会话累计。
 *
 * 两处来源相加：每条回复自己的记录，以及 `extraCosts`（压缩摘要这类不属于任何一条
 * 回复的请求——钱真花了，但不该挂在某条回答头上，所以只在合计里体现）。
 *
 * 一条都没有时返回 null，界面据此整块不渲染：不知道、不归我付，和确实花了 0 元，
 * 必须长得不一样。
 *
 * 统计的是会话里的全部回复，包括被重新生成后没在显示的旧版本：那些版本也真花过钱。
 */
export const sessionCost = (session: Session): SessionCost | null => {
  let nano = 0
  let priced = 0
  let unpriced = 0
  for (const message of session.messages) {
    if (!isAssistant(message)) {
      continue
    }
    if (message.costs && message.costs.length > 0) {
      nano += messageCostNano(message)
      priced += 1
    } else if (message.status !== 'pending') {
      // 还没收到任何事件的空壳不算「未计价的一轮」，否则每次打字都会闪一下计数
      unpriced += 1
    }
  }
  for (const cost of session.extraCosts ?? []) {
    nano += cost.nano
  }
  const hasExtra = (session.extraCosts ?? []).length > 0
  return priced === 0 && !hasExtra ? null : { nano, priced, unpriced }
}
