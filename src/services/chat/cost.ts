import { costOfUsage, isPeak, priceFor, tierAt, type UsageForCost } from './pricing.js'
import type { AssistantMessage, Message, RequestCost, Session } from './types.js'

/**
 * 记账：把一次请求的用量换成一条成本记录，追加到回复上。
 *
 * 只在请求真正发出、并拿到服务端 usage 之后调用一次。续写与断线自动续写各自算一笔，
 * 所以是同一条回复上追加，而不是覆盖。
 *
 * 认不出价格时**不记**（返回原对象）：界面据此把这条回复算作「未计价」，
 * 而不是拿一个默认价糊上去。
 */
export const accrueCost = (
  reply: AssistantMessage,
  usage: UsageForCost,
  at: number
): AssistantMessage => {
  const price = priceFor(reply.model, reply.servedModel)
  if (!price) {
    return reply
  }
  const priced = costOfUsage(usage, tierAt(price, at))
  const tokens =
    priced.input + priced.cacheRead + priced.cacheWrite + priced.output
  if (tokens <= 0) {
    // 服务端没给用量（例如请求中途断开），没有可记的东西
    return reply
  }
  const cost: RequestCost = {
    at,
    peak: isPeak(at),
    model: reply.servedModel || reply.model || '',
    input: priced.input,
    cacheRead: priced.cacheRead,
    cacheWrite: priced.cacheWrite,
    output: priced.output,
    rates: priced.rates,
    nano: priced.nano,
  }
  return { ...reply, costs: [...(reply.costs ?? []), cost] }
}

/** 这条回复花了多少（纳元） */
export const messageCostNano = (message: AssistantMessage): number =>
  (message.costs ?? []).reduce((sum, cost) => sum + cost.nano, 0)

/**
 * 这条回复的所有请求是否都按峰价。
 * 一半峰一半谷时不标峰：那种情况只有明细里逐条说才清楚。
 */
export const messageAllPeak = (message: AssistantMessage): boolean => {
  const costs = message.costs ?? []
  return costs.length > 0 && costs.every((cost) => cost.peak)
}

const isAssistant = (message: Message): message is AssistantMessage => message.role === 'assistant'

export type SessionCost = {
  /** 本会话已计价请求的合计，纳元 */
  nano: number
  /** 有成本记录的回复条数 */
  priced: number
  /** 没有成本记录的回复条数（导入的历史、旧版本留下的消息） */
  unpriced: number
}

/**
 * 会话累计。
 *
 * 只累计带成本记录的回复；一条都没有时返回 null，界面据此整块不渲染——
 * 「不知道 / 不归我付」和「确实花了 0 元」必须长得不一样。
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
  return priced === 0 ? null : { nano, priced, unpriced }
}
