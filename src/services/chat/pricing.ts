/**
 * 花费口径：用量来自服务端回报的 usage，单价是随代码发布的常量。
 *
 * 三条不能动的规矩：
 * 1. 单价一律用「纳元 / token」整数表示（1 纳元 = 1e-9 元）。官方价目按「元 / 百万 token」
 *    公布，换算过来刚好全是整数，于是整条链路是整数乘加，不产生浮点尾数。
 * 2. 峰谷按**请求发起时刻**定档，整笔请求不拆分。周末与法定假日全天谷价。
 * 3. 日历一律按 UTC+8 算，UTC 小时只看钟点。设备时区错了也不该算错钱。
 *
 * 价目表随版本发布：官方调价时改这张表 + 改 PRICING_UPDATED_AT，发一版即可。
 */

/** 一档单价，纳元 / token */
export type PriceTier = {
  /** 缓存命中（输入） */
  hit: number
  /** 缓存未命中（输入） */
  miss: number
  /** 输出 */
  out: number
}

export type ModelPrice = {
  /** 谷价（空闲时段）：官方价目表的主档 */
  off: PriceTier
  /** 峰价（高峰时段） */
  peak: PriceTier
}

/** 价目表的日期。界面上的「按 X 价目」用它，改价时一起改。 */
export const PRICING_UPDATED_AT = '2026-11-25'

/**
 * 官方价目（元 / 百万 token）换算成纳元 / token 后全是整数：
 * flash 0.02 / 1 / 4 与 0.04 / 2 / 8；pro 0.15 / 4.5 / 13.5 与 0.30 / 9 / 27。
 */
export const PRICES: Record<string, ModelPrice> = {
  'deepseek-flash': {
    off: { hit: 20, miss: 1_000, out: 4_000 },
    peak: { hit: 40, miss: 2_000, out: 8_000 },
  },
  'deepseek-v4-pro': {
    off: { hit: 150, miss: 4_500, out: 13_500 },
    peak: { hit: 300, miss: 9_000, out: 27_000 },
  },
}

/** 峰时段，UTC 小时，半开区间：含起点不含终点。01-04、06-10 = 北京 09-12、14-18 */
export const PEAK_WINDOWS: { start: number; end: number }[] = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
]

/** 峰谷计价生效时刻；更早的历史一律按谷价 */
export const PEAK_EFFECTIVE_AT = Date.parse('2026-08-01T00:00:00Z')

/**
 * 法定假日（北京时间日期），全天谷价。
 *
 * 只抄当前有据可依的那一段：中秋与国庆（与 dsh-cost-meter 记录的同期假日表一致）。
 * 元旦、春节、清明、劳动、端午没有可核对的来源，**不凭印象填**——没进表的日子按平时
 * 的峰谷算，代价是那几个假日会按峰价显示（偏高一点），而不是凭空给它一个谷价。
 * 拿到官方安排后补日期、改 PRICING_UPDATED_AT，发一版即可。
 */
export const HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
])

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 北京时间日期键 YYYY-MM-DD */
const beijingDay = (atMs: number): string =>
  new Date(atMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10)

/** 北京时间星期：0 = 周日 */
const beijingWeekday = (atMs: number): number => new Date(atMs + BEIJING_OFFSET_MS).getUTCDay()

/**
 * 该时刻是否按峰价计。
 *
 * 顺序：先看峰谷是否已生效，再看是不是周末或假日（全谷价），最后看 UTC 钟点落没落在峰时段。
 * 钟点带小数：一小时是连续的量，09:59:59 仍在峰时段里。
 */
export const isPeak = (atMs: number): boolean => {
  if (!Number.isFinite(atMs) || atMs < PEAK_EFFECTIVE_AT) {
    return false
  }
  const weekday = beijingWeekday(atMs)
  if (weekday === 0 || weekday === 6) {
    return false
  }
  if (HOLIDAYS.has(beijingDay(atMs))) {
    return false
  }
  const utc = new Date(atMs)
  const hour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600
  return PEAK_WINDOWS.some(({ start, end }) => hour >= start && hour < end)
}

/** 取的档位单价；不在峰时段就是谷价 */
export const tierAt = (price: ModelPrice, atMs: number): PriceTier =>
  isPeak(atMs) ? price.peak : price.off

/**
 * 模型 → 价目行。
 *
 * 先看服务端回报的真实模型名（别名可能解析到别的模型），再看界面上选的名字。
 * 名字带版本后缀（-1017、-0813）与快照标签，按家族前缀归并；认不出的返回 null，
 * 由调用方记成「未计价」，而不是拿一个默认价糊上去。
 */
export const priceFor = (model: string | null | undefined, servedModel?: string): ModelPrice | null => {
  const candidates = [servedModel, model]
  for (const name of candidates) {
    if (typeof name !== 'string' || name.length === 0) {
      continue
    }
    const key = name.trim().toLowerCase()
    if (PRICES[key]) {
      return PRICES[key]
    }
    // pro 必须先判：deepseek-v4-pro 也满足后面的 flash 家族通配
    if (/^deepseek-(v4(\.1)?-)?pro/.test(key)) {
      return PRICES['deepseek-v4-pro'] ?? null
    }
    if (/^deepseek-.*flash/.test(key)) {
      return PRICES['deepseek-flash'] ?? null
    }
  }
  return null
}

/** 计价用的 usage 子集；字段语义见 MessageUsage */
export type UsageForCost = {
  input_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens: number
  output_tokens: number
}

export type PricedUsage = {
  /** 未命中输入的 token（不含缓存写入） */
  input: number
  cacheRead: number
  /** 缓存写入的 token；官方价目表没有这一档，按未命中价计 */
  cacheWrite: number
  output: number
  /** 这次请求的实际单价快照，纳元 / token */
  rates: { miss: number; hit: number; write: number; out: number }
  /** 这次请求的成本，纳元 */
  nano: number
}

/** 非有限值、负数一律按 0：服务端偶尔给 null，不能让它污染总账 */
const safe = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

/**
 * 一次请求的成本。
 *
 * 缓存写入并入未命中价：官方价目表只有「命中 / 未命中」两档，写入本质是首次进入的输入，
 * 按未命中价收才不自欺。若接口从不返回 cache_creation（实测为 0），这一项自然为 0。
 */
export const costOfUsage = (usage: UsageForCost, tier: PriceTier): PricedUsage => {
  const input = safe(usage.input_tokens)
  const cacheRead = safe(usage.cache_read_input_tokens)
  const cacheWrite = safe(usage.cache_creation_input_tokens)
  const output = safe(usage.output_tokens)
  const rates = { miss: tier.miss, hit: tier.hit, write: tier.miss, out: tier.out }
  const nano = (input + cacheWrite) * rates.miss + cacheRead * rates.hit + output * rates.out
  return { input, cacheRead, cacheWrite, output, rates, nano }
}

/** 一纳元 = 1e-9 元；四位小数的最小刻度是 1e-4 元 = 100000 纳元 */
const NANO_PER_UNIT = 100_000

/**
 * 金额显示：固定四位小数，不带千分位。
 *
 * 四位的刻度就是「精确到万分之一元」，所以补零，而不是省掉尾零。
 * 不足万分之一元时不写 ¥0.0000（那会被读成免费），写 <¥0.0001。
 */
export const formatCost = (nano: number): string => {
  if (!Number.isFinite(nano) || nano <= 0) {
    return '¥0.0000'
  }
  const units = Math.round(nano / NANO_PER_UNIT)
  if (units <= 0) {
    return '<¥0.0001'
  }
  const yuan = Math.floor(units / 10_000)
  const fraction = String(units % 10_000).padStart(4, '0')
  return `¥${yuan}.${fraction}`
}

/**
 * 单价显示：纳元 / token → 元 / 百万 token，去掉多余的零。
 * 1000 纳元/token 就是 1 元/M，20 就是 0.02 元/M。
 */
export const formatRate = (nanoPerToken: number): string => {
  const perMillion = nanoPerToken / 1_000
  const text = perMillion.toFixed(4).replace(/\.?0+$/, '')
  return text.length === 0 ? '0' : text
}
