import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyCompaction,
  estimatePromptTokens,
  estimateRequestTokens,
  getContextUsage,
  needsCompaction,
  planCompaction,
  requestKeyOf,
} from '../src/services/chat/compaction.js'
import { ESTIMATE_VERSION, estimateTokens } from '../src/services/chat/tokens.js'
import { useSettings } from '../src/services/settings.js'
import type { AssistantMessage, Message, Session, UserMessage } from '../src/services/chat/types.js'
import { compactionRecord, userMessage } from './helpers.js'

/**
 * 压缩 → 撤销 → 再压缩 → 再撤销 这条链上，锚点必须一直指回「压缩前那条」。
 * 这个文件只测纯函数，不碰 IndexedDB、不打网络。
 */

let seq = 0
const nextId = () => `m${(seq += 1)}`

/** 一条带实测的回复：promptEstimate 与 usage 故意差得远，模拟"估算远低于真实" */
const reply = (
  text: string,
  createdAt: number,
  { usage = 10_000, estimate = 1_200 }: { usage?: number; estimate?: number } = {}
): AssistantMessage => ({
  id: nextId(),
  role: 'assistant',
  createdAt,
  model: null,
  prefix: true,
  status: 'done',
  blocks: [{ type: 'text', text }],
  usage: {
    input_tokens: usage,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 10,
  },
  promptEstimate: estimate,
  estimateVersion: ESTIMATE_VERSION,
  // 当前版本写下的回复都带请求形状，缺了会被判成"换了模型"
  requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: false }),
})

const ask = (text: string): UserMessage => ({ ...userMessage(text, nextId()), createdAt: 0 })

const sessionOf = (messages: Message[], over: Partial<Session> = {}): Session => ({
  id: 's',
  title: '测试',
  createdAt: 0,
  updatedAt: 0,
  messages,
  ...over,
})

test('撤销后按压缩前那条算：数值等于「压缩前实测 + 期间增量」', () => {
  const q1 = ask(`问：${'甲'.repeat(2_000)}`)
  const big = reply(`答：${'乙'.repeat(2_000)}`, 100)
  const q2 = ask('再问')
  const small = reply('短回答', 400, { usage: 500, estimate: 480 })
  const messages = [q1, big, q2, small]

  const plain = getContextUsage(sessionOf(messages))
  const undone = getContextUsage(sessionOf(messages, { anchorId: big.id }))
  assert.ok(plain && undone)

  assert.equal(undone.anchor, 'measured')
  assert.equal(undone.anchorId, big.id)
  assert.equal(undone.anchorUsed, 10_000)
  const raw = estimateRequestTokens(messages)
  assert.equal(undone.used, 10_000 + (raw - 1_200))
  // 用"最近一条小实测"会算出明显更小的数——这正是要避免的
  assert.ok(undone.used > plain.used, `${undone.used} 应大于 ${plain.used}`)
})

test('压缩后又聊了两轮再撤销：那两轮的量要算进去', () => {
  const q1 = ask(`问：${'甲'.repeat(1_000)}`)
  const big = reply('第一答', 100)
  const q2 = ask(`再问：${'丙'.repeat(800)}`)
  const mid = reply('第二答', 200, { usage: 2_000, estimate: 1_800 })
  const q3 = ask('又问')
  const last = reply('第三答', 300, { usage: 1_000, estimate: 900 })
  const messages = [q1, big, q2, mid, q3, last]

  const usage = getContextUsage(sessionOf(messages, { anchorId: big.id }))
  assert.ok(usage)
  assert.equal(usage.anchorUsed, 10_000)
  assert.equal(usage.anchorId, big.id)
  // 两轮之后的量都落在增量里
  const raw = estimateRequestTokens(messages)
  assert.equal(usage.used, 10_000 + (raw - 1_200))
})

test('撤销 → 再压缩 → 再撤销：仍然回到最初那条', () => {
  const q1 = ask(`问：${'甲'.repeat(2_000)}`)
  const big = reply('第一答', 100)
  const q2 = ask('再问')
  const small = reply('短答', 400, { usage: 400, estimate: 380 })
  const base = [q1, big, q2, small]

  // 第一次撤销：会话上挂着"压缩前是 big"
  const first = sessionOf(base, { anchorId: big.id })
  const firstUsage = getContextUsage(first)
  assert.ok(firstUsage)

  // 再压缩一次：记录里记下"这次压缩前生效的锚点"
  const twice = sessionOf(base, {
    anchorId: big.id,
    compaction: compactionRecord({
      coveredIds: [q1.id, big.id],
      createdAt: 500,
      anchorId: big.id,
    }),
  })
  // 带着压缩记录时，锚点早于记录 → 丢弃，退回估算（这是既有规则，不许被改坏）
  const duringSecond = getContextUsage(twice)
  assert.ok(duringSecond)
  assert.equal(duringSecond.anchorDropReason, 'compaction')

  // 再撤销一次：锚点仍是 big，数值与第一次撤销后完全一致
  const second = sessionOf(base, { anchorId: twice.compaction?.anchorId })
  const secondUsage = getContextUsage(second)
  assert.ok(secondUsage)
  assert.equal(secondUsage.anchorId, big.id)
  assert.equal(secondUsage.used, firstUsage.used)
})

test('覆盖段包含全部消息时，请求里只剩摘要', () => {
  const q1 = ask('问一')
  const a1 = reply('答一', 100)
  const record = compactionRecord({ coveredIds: [q1.id, a1.id], summary: '全都压了', createdAt: 200 })
  const { history, summary } = applyCompaction([q1, a1], record)
  assert.equal(history.length, 0)
  assert.equal(summary, '全都压了')

  const usage = getContextUsage(sessionOf([q1, a1], { compaction: record }))
  assert.ok(usage)
  assert.equal(usage.compacted, true)
  assert.ok(usage.summaryTokens > 0, '摘要必须单独占一行')
})

test('只有一对问答时不可压', () => {
  const messages = [ask('问'), reply('答', 100)]
  assert.equal(planCompaction(messages, 1_000_000, { manual: true }), null)
  assert.equal(needsCompaction(sessionOf(messages)), false)
})

test('面板数与闸门数是同一个数', () => {
  const messages = [ask(`问：${'甲'.repeat(1_500)}`), reply('答', 100)]
  const session = sessionOf(messages)
  assert.equal(getContextUsage(session)?.used, estimatePromptTokens(session))
  // 带待发提问时，闸门用的是"加上这句话"之后的数
  const question = ask(`追加：${'乙'.repeat(100)}`)
  assert.ok(estimatePromptTokens(session, question) > estimatePromptTokens(session))
  // 100 个汉字按 0.75 折算 = 75
  assert.equal(estimateTokens('乙'.repeat(100)), 75)
})
