import { API_ORIGIN } from './api/client.js'

/**
 * 账户余额。DeepSeek 的余额接口不在 Anthropic 兼容前缀下，路径与鉴权方式需要实测确认，
 * 所以这里按候选列表依次尝试，第一个成功的即作为结果。
 */

export type BalanceInfo = {
  currency: string
  /** 总余额（可能是字符串，接口原样给出） */
  total: string
  /** 赠送余额 */
  granted: string
  /** 充值余额 */
  toppedUp: string
}

/**
 * 账户是否可用。
 *
 * 接口对 `is_available` 有三种可能：真、假、压根没给。三者含义不同，不能压成一个布尔：
 * 缺字段说明这个接口版本没这个信息（按不可用处理更保守），值非法（字符串、数字）
 * 说明接口在变，界面要如实说"不知道"，而不是替它猜。
 */
export type BalanceAvailability = 'available' | 'unavailable' | 'missing' | 'invalid'

export type BalanceSnapshot = {
  availability: BalanceAvailability
  /** 各币种余额，接口可能返回多个 */
  infos: BalanceInfo[]
}

export type BalanceResult =
  | { ok: true; snapshot: BalanceSnapshot; endpoint: string }
  | { ok: false; message: string; tried: string[] }

type Candidate = { path: string; auth: 'bearer' | 'apiKey' }

/** 候选端点：实测 /user/balance + Bearer 可用；保留 x-api-key 形式作为鉴权回退 */
const CANDIDATES: Candidate[] = [
  { path: '/user/balance', auth: 'bearer' },
  { path: '/user/balance', auth: 'apiKey' },
]

const headersFor = (candidate: Candidate, apiKey: string): Record<string, string> => ({
  Accept: 'application/json',
  ...(candidate.auth === 'bearer'
    ? { Authorization: `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
})

const readString = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

/** 解析 { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] } */
export const parseBalanceSnapshot = (body: unknown): BalanceSnapshot | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const record = body as Record<string, unknown>
  const raw = record.balance_infos
  if (!Array.isArray(raw)) {
    return null
  }
  const infos = raw.flatMap((item): BalanceInfo[] => {
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const entry = item as Record<string, unknown>
    return [
      {
        currency: readString(entry.currency),
        total: readString(entry.total_balance),
        granted: readString(entry.granted_balance),
        toppedUp: readString(entry.topped_up_balance),
      },
    ]
  })
  if (infos.length === 0) {
    return null
  }
  const rawAvailable = record.is_available
  const availability: BalanceAvailability =
    typeof rawAvailable === 'boolean'
      ? rawAvailable
        ? 'available'
        : 'unavailable'
      : rawAvailable === undefined
        ? 'missing'
        : 'invalid'
  return { availability, infos }
}

export const fetchBalance = async (apiKey: string, signal?: AbortSignal): Promise<BalanceResult> => {
  const tried: string[] = []
  let lastMessage = ''
  for (const candidate of CANDIDATES) {
    const url = `${API_ORIGIN}${candidate.path}`
    tried.push(`${candidate.path}(${candidate.auth})`)
    try {
      const response = await fetch(url, { headers: headersFor(candidate, apiKey), signal })
      const text = await response.text()
      if (!response.ok) {
        lastMessage = `HTTP ${response.status}`
        continue
      }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        lastMessage = '响应不是 JSON'
        continue
      }
      const snapshot = parseBalanceSnapshot(body)
      if (!snapshot) {
        lastMessage = '响应结构不符合预期'
        continue
      }
      return { ok: true, snapshot, endpoint: candidate.path }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
  }
  return { ok: false, message: lastMessage || '未知错误', tried }
}

/** 用于展示：¥ 或对应币种前缀 */
export const formatBalance = ({ currency, total }: BalanceInfo): string => {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return symbol ? `${symbol}${total}` : `${total} ${currency}`
}
