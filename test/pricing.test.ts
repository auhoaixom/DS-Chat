import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HOLIDAYS,
  PRICES,
  PRICING_UPDATED_AT,
  costOfUsage,
  formatCost,
  formatRate,
  isPeak,
  priceFor,
  tierAt,
  type ModelPrice,
  type PriceTier,
} from '../src/services/chat/pricing.js'

const FLASH_OFF: PriceTier = { hit: 20, miss: 1_000, out: 4_000 }
const FLASH_PEAK: PriceTier = { hit: 40, miss: 2_000, out: 8_000 }
const PRO_OFF: PriceTier = { hit: 150, miss: 4_500, out: 13_500 }
const PRO_PEAK: PriceTier = { hit: 300, miss: 9_000, out: 27_000 }
const FLASH: ModelPrice = { off: FLASH_OFF, peak: FLASH_PEAK }
const PRO: ModelPrice = { off: PRO_OFF, peak: PRO_PEAK }

test('价目表按纳元/token 存成整数（元/百万 token 除以 1000）', () => {
  assert.deepEqual(PRICES['deepseek-flash'], FLASH)
  assert.deepEqual(PRICES['deepseek-v4-pro'], PRO)
  assert.equal(PRICING_UPDATED_AT, '2026-11-25')
})

test('峰时段：UTC 01-04、06-10，半开区间', () => {
  // 2026-11-25 是周三
  assert.equal(isPeak(Date.parse('2026-11-25T00:59:59Z')), false)
  assert.equal(isPeak(Date.parse('2026-11-25T01:00:00Z')), true)
  assert.equal(isPeak(Date.parse('2026-11-25T03:59:59Z')), true)
  assert.equal(isPeak(Date.parse('2026-11-25T04:00:00Z')), false)
  assert.equal(isPeak(Date.parse('2026-11-25T06:00:00Z')), true)
  assert.equal(isPeak(Date.parse('2026-11-25T09:59:00Z')), true)
  assert.equal(isPeak(Date.parse('2026-11-25T10:00:00Z')), false)
})

test('北京时间对应关系：UTC 01-04 / 06-10 就是北京 09-12 / 14-18', () => {
  // 北京 09:00 = UTC 01:00
  assert.equal(isPeak(Date.parse('2026-11-25T01:00:00Z')), true)
  // 北京 20:00 = UTC 12:00，不在峰时段
  assert.equal(isPeak(Date.parse('2026-11-25T12:00:00Z')), false)
  // 北京次日 00:30 = UTC 前一天 16:30
  assert.equal(isPeak(Date.parse('2026-11-25T16:30:00Z')), false)
})

test('周末全天谷价（2026-11-28 周六、11-29 周日）', () => {
  assert.equal(isPeak(Date.parse('2026-11-28T01:30:00Z')), false)
  assert.equal(isPeak(Date.parse('2026-11-29T07:30:00Z')), false)
  // 周五同一时刻是峰价，确认判据是星期而不是碰巧
  assert.equal(isPeak(Date.parse('2026-11-27T01:30:00Z')), true)
})

test('法定假日全天谷价（表内写的是北京时间日期）', () => {
  for (const day of HOLIDAYS) {
    // 取该日北京 09:30 = UTC 01:30
    assert.equal(isPeak(Date.parse(`${day}T01:30:00Z`)), false, `${day} 应当是谷价`)
  }
})

test('峰谷生效时刻之前一律谷价', () => {
  assert.equal(isPeak(Date.parse('2026-07-31T23:59:59Z')), false)
  assert.equal(isPeak(Date.parse('2026-01-05T02:00:00Z')), false)
})

test('非有限时刻按谷价处理，不抛错', () => {
  assert.equal(isPeak(Number.NaN), false)
})

test('模型匹配：先看服务端回报的名字，再按家族前缀归并', () => {
  assert.deepEqual(priceFor('deepseek-flash'), FLASH)
  assert.deepEqual(priceFor('deepseek-v4-pro'), PRO)
  assert.deepEqual(priceFor(null, 'deepseek-v4.1-flash-1017'), FLASH)
  assert.deepEqual(priceFor(null, 'deepseek-v4-flash-0731'), FLASH)
  assert.deepEqual(priceFor('DeepSeek-Flash'), FLASH)
  assert.deepEqual(priceFor(null, 'deepseek-v4-pro-0813'), PRO)
  assert.deepEqual(priceFor(null, 'deepseek-v4.1-pro'), PRO)
})

test('服务端回报的模型名优先于界面上选的名字', () => {
  // 别名 deepseek-flash 被解析成了 pro：钱得按 pro 算
  assert.deepEqual(priceFor('deepseek-flash', 'deepseek-v4-pro'), PRO)
})

test('认不出的模型不猜价格', () => {
  assert.equal(priceFor('gpt-4o'), null)
  assert.equal(priceFor(undefined, undefined), null)
  assert.equal(priceFor(''), null)
})

test('档位：峰时段取 peak，其余取 off', () => {
  assert.deepEqual(tierAt(FLASH, Date.parse('2026-11-25T02:00:00Z')), FLASH_PEAK)
  assert.deepEqual(tierAt(FLASH, Date.parse('2026-11-25T12:00:00Z')), FLASH_OFF)
})

test('成本：四类 token 各按自己的单价算，整数相加', () => {
  const priced = costOfUsage(
    {
      input_tokens: 1_000,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 0,
      output_tokens: 500,
    },
    FLASH_OFF
  )
  // 1000×1000 + 10000×20 + 500×4000 = 3 200 000 纳元 = 0.0032 元
  assert.equal(priced.nano, 3_200_000)
  assert.deepEqual(priced.rates, { miss: 1_000, hit: 20, write: 1_000, out: 4_000 })
})

test('缓存写入按未命中价计，并单独记 token', () => {
  const priced = costOfUsage(
    {
      input_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 900,
      output_tokens: 0,
    },
    FLASH_OFF
  )
  assert.equal(priced.cacheWrite, 900)
  assert.equal(priced.nano, (100 + 900) * 1_000)
})

test('用量缺字段或非法值按 0 处理，不污染总账', () => {
  const priced = costOfUsage(
    {
      input_tokens: Number.NaN,
      cache_read_input_tokens: -5,
      output_tokens: 2,
    } as never,
    FLASH_OFF
  )
  assert.equal(priced.input, 0)
  assert.equal(priced.cacheRead, 0)
  assert.equal(priced.nano, 2 * 4_000)
})

test('金额显示：固定四位，不足万分之一元写小于号', () => {
  assert.equal(formatCost(0), '¥0.0000')
  assert.equal(formatCost(Number.NaN), '¥0.0000')
  assert.equal(formatCost(30_000), '<¥0.0001')
  assert.equal(formatCost(3_200_000), '¥0.0032')
  assert.equal(formatCost(1_234_500_000), '¥1.2345')
  assert.equal(formatCost(12_000_000_000), '¥12.0000')
  // 0.00325 元四舍五入到四位
  assert.equal(formatCost(3_250_000), '¥0.0033')
})

test('单价显示：元 / 百万 token，去掉多余的零', () => {
  assert.equal(formatRate(20), '0.02')
  assert.equal(formatRate(1_000), '1')
  assert.equal(formatRate(4_500), '4.5')
  assert.equal(formatRate(13_500), '13.5')
  assert.equal(formatRate(0), '0')
})
