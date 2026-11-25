import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accrueCost, messageCostNano, messageTier, sessionCost } from '../src/services/chat/cost.js'
import type { AssistantMessage, Message, Session } from '../src/services/chat/types.js'
import { assistantMessage, userMessage } from './helpers.js'

/** 2026-11-25 是周三，UTC 02:00 = 北京 10:00，峰时段 */
const PEAK_AT = Date.parse('2026-11-25T02:00:00Z')
/** 同一周的晚上，谷价 */
const OFF_AT = Date.parse('2026-11-25T12:00:00Z')

const usage = (input: number, cacheRead: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
  output_tokens: output,
})

const reply = (over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  ...assistantMessage('回答'),
  model: 'deepseek-flash',
  ...over,
})

const sessionOf = (messages: Message[]): Session => ({
  id: 's1',
  title: '会话',
  createdAt: 0,
  updatedAt: 0,
  messages,
  rootMessageId: null,
})

test('峰时段记一笔：单价取峰价，档位标 true', () => {
  const priced = accrueCost(reply(), usage(1_000, 0, 0), PEAK_AT)
  assert.equal(priced.costs?.length, 1)
  assert.equal(priced.costs?.[0]?.peak, true)
  // flash 峰价未命中 2000 纳元/token
  assert.equal(priced.costs?.[0]?.nano, 1_000 * 2_000)
  assert.deepEqual(priced.costs?.[0]?.rates, { miss: 2_000, hit: 40, write: 2_000, out: 8_000 })
})

test('谷价时段单价减半', () => {
  const priced = accrueCost(reply(), usage(1_000, 0, 0), OFF_AT)
  assert.equal(priced.costs?.[0]?.peak, false)
  assert.equal(priced.costs?.[0]?.nano, 1_000 * 1_000)
})

test('续写：同一回复上追加，不覆盖', () => {
  const first = accrueCost(reply(), usage(1_000, 0, 0), OFF_AT)
  const second = accrueCost(first, usage(0, 0, 100), OFF_AT)
  assert.equal(second.costs?.length, 2)
  assert.equal(messageCostNano(second), 1_000 * 1_000 + 100 * 4_000)
})

test('服务端没给用量（空 usage）不记账', () => {
  const priced = accrueCost(reply(), usage(0, 0, 0), OFF_AT)
  assert.equal(priced.costs, undefined)
})

test('认不出价格时不记账（该轮算未计价）', () => {
  const priced = accrueCost(reply({ model: 'gpt-4o' }), usage(1_000, 0, 0), OFF_AT)
  assert.equal(priced.costs, undefined)
})

test('服务端回报的模型名决定单价', () => {
  const priced = accrueCost(
    reply({ model: 'deepseek-flash', servedModel: 'deepseek-v4-pro-0813' }),
    usage(1_000, 0, 0),
    OFF_AT
  )
  // pro 谷价未命中 4500 纳元/token
  assert.equal(priced.costs?.[0]?.nano, 1_000 * 4_500)
  assert.equal(priced.costs?.[0]?.model, 'deepseek-v4-pro-0813')
})

test('档位三态：全峰、全谷、跨时段边界的混合', () => {
  const allPeak = accrueCost(accrueCost(reply(), usage(10, 0, 0), PEAK_AT), usage(10, 0, 0), PEAK_AT)
  assert.equal(messageTier(allPeak), 'peak')
  const allOff = accrueCost(accrueCost(reply(), usage(10, 0, 0), OFF_AT), usage(10, 0, 0), OFF_AT)
  assert.equal(messageTier(allOff), 'off')
  const mixed = accrueCost(allPeak, usage(10, 0, 0), OFF_AT)
  assert.equal(messageTier(mixed), 'mixed')
  assert.equal(messageTier(reply()), null)
})

test('会话累计：没有成本记录时返回 null，界面整块不渲染', () => {
  assert.equal(sessionCost(sessionOf([])), null)
  assert.equal(sessionCost(sessionOf([userMessage('问'), assistantMessage('答')])), null)
})

test('会话累计：只算有成本记录的回复，导入的历史记成未计价', () => {
  const pricedReply = accrueCost(reply(), usage(1_000, 0, 0), OFF_AT)
  const session = sessionOf([
    userMessage('导入的老问题'),
    assistantMessage('导入的老回答'),
    userMessage('新问题'),
    pricedReply,
  ])
  const cost = sessionCost(session)
  assert.equal(cost?.priced, 1)
  assert.equal(cost?.unpriced, 1)
  assert.equal(cost?.nano, 1_000 * 1_000)
})

test('会话累计：还没收到事件的空壳不算未计价的一轮', () => {
  const pricedReply = accrueCost(reply(), usage(1_000, 0, 0), OFF_AT)
  const session = sessionOf([
    pricedReply,
    { ...assistantMessage(''), status: 'pending', blocks: [] } as AssistantMessage,
  ])
  assert.equal(sessionCost(session)?.unpriced, 0)
})

test('压缩这类不属于任何回复的请求，只进会话合计', () => {
  const pricedReply = accrueCost(reply(), usage(1_000, 0, 0), OFF_AT)
  const compactionCost = accrueCost(reply(), usage(0, 0, 200), OFF_AT).costs ?? []
  const session = sessionOf([userMessage('问'), pricedReply])
  session.extraCosts = compactionCost
  const cost = sessionCost(session)
  assert.equal(cost?.priced, 1)
  assert.equal(cost?.nano, 1_000 * 1_000 + 200 * 4_000)
})

test('只有压缩开销、没有已计价回复时也给出合计', () => {
  const session = sessionOf([userMessage('问'), assistantMessage('答')])
  session.extraCosts = accrueCost(reply(), usage(0, 0, 200), OFF_AT).costs ?? []
  const cost = sessionCost(session)
  assert.equal(cost?.priced, 0)
  assert.equal(cost?.nano, 200 * 4_000)
})
