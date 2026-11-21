import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSessionFile } from '../src/services/chat/history/schema.js'
import { toSessionFile } from '../src/services/chat/history/toArchive.js'
import { toLocalSession } from '../src/services/chat/history/toLocal.js'
import { getVisibleMessages } from '../src/services/chat/branches.js'
import type { AssistantMessage, Session } from '../src/services/chat/types.js'
import { assistantMessage, compactionRecord, userMessage } from './helpers.js'

/**
 * 「导出 → 导入」往返：这是压缩记录、全部消息分支、逐条用量的唯一保障。
 * 归档是 JSON，所以这里刻意先序列化再解析，模拟真实的落盘与读回。
 */
const roundTrip = (session: Session): Session => {
  const file = toSessionFile(session, () => null)
  return toLocalSession(readSessionFile(JSON.parse(JSON.stringify(file)))).session
}

const reply = (text: string, id: string, parentId: string, over: Partial<AssistantMessage> = {}) => ({
  ...assistantMessage(text, id),
  parentId,
  status: 'done' as const,
  model: 'deepseek-flash' as const,
  servedModel: 'deepseek-v4.1-flash',
  promptEstimate: 1_234,
  latestReminder: '今天是 2026-11-22，用户位于杭州',
  usage: {
    input_tokens: 1_000,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 800,
    output_tokens: 300,
  },
  ...over,
})

const sample = (): Session => ({
  id: 's1',
  title: '往返测试',
  createdAt: 1_000,
  updatedAt: 2_000,
  // 显式给出根节点与选中关系，否则 normalizeSession 会把这份数据当成线性会话重排
  rootMessageId: 'm1',
  // 一条提问挂两个回答：第二个版本才是当前选中的那一支
  messages: [
    { ...userMessage('杭州有什么茶？', 'm1'), parentId: null, selectedChildId: 'm3' },
    reply('西湖龙井。', 'm2', 'm1'),
    { ...reply('龙井，明前最好。', 'm3', 'm1'), selectedChildId: 'm4' },
    { ...userMessage('明前是什么？', 'm4'), parentId: 'm3', selectedChildId: 'm5' },
    { ...reply('清明前采的头茬。', 'm5', 'm4'), status: 'done' as const },
  ],
  compaction: compactionRecord({
    summary: '用户问了杭州的茶，助手介绍了龙井。',
    coveredIds: ['m1', 'm2'],
    createdAt: 1_500,
    mode: 'manual',
    beforeTokens: 12_000,
    afterTokens: 1_200,
    summaryUsage: { input: 11_000, cacheRead: 10_000, cacheWrite: 0 },
    viaReplay: true,
  }),
  pinned: true,
})

test('往返之后：压缩记录原样回来', () => {
  const original = sample()
  const restored = roundTrip(original)
  assert.ok(restored.compaction, '压缩记录丢了')
  assert.equal(restored.compaction.summary, original.compaction?.summary)
  assert.equal(restored.compaction.mode, 'manual')
  assert.equal(restored.compaction.beforeTokens, 12_000)
  assert.equal(restored.compaction.afterTokens, 1_200)
  assert.deepEqual(restored.compaction.summaryUsage, { input: 11_000, cacheRead: 10_000, cacheWrite: 0 })
  assert.equal(restored.compaction.viaReplay, true)
  // 归档会重新编号，覆盖段要指到"原本那两条消息"现在的 id 上
  assert.equal(restored.compaction.coveredIds.length, 2)
  for (const id of restored.compaction.coveredIds) {
    assert.ok(
      restored.messages.some((message) => message.id === id),
      `覆盖段里的 ${id} 在导入后不存在`
    )
  }
})

test('往返之后：全部消息（含未被选中的版本）都在，树结构不变', () => {
  const restored = roundTrip(sample())
  assert.equal(restored.messages.length, 5, '有分支的消息被丢掉了')
  const byText = new Map(
    restored.messages.map((message) => [message.role === 'user' ? message.content : '', message])
  )
  assert.ok(byText.has('杭州有什么茶？'))
  // 两条回答都还在，说明导出的是整棵树而不是当前选中路径
  const answers = restored.messages.filter((message) => message.role === 'assistant')
  assert.equal(answers.length, 3)
  // 当前停留位置仍然是「清明前采的头茬」这一支
  const visible = getVisibleMessages(restored)
  const leaf = visible.at(-1)
  assert.equal(leaf?.role, 'assistant')
  assert.ok(
    leaf?.role === 'assistant' &&
      leaf.blocks.some((block) => block.type === 'text' && block.text.includes('头茬'))
  )
})

test('往返之后：逐条用量、系统信息快照、模型名都回来', () => {
  const restored = roundTrip(sample())
  const answers = restored.messages.filter(
    (message): message is AssistantMessage => message.role === 'assistant'
  )
  for (const answer of answers) {
    assert.deepEqual(answer.usage, {
      input_tokens: 1_000,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 800,
      output_tokens: 300,
    })
    assert.equal(answer.promptEstimate, 1_234)
    assert.equal(answer.servedModel, 'deepseek-v4.1-flash')
    assert.equal(answer.latestReminder, '今天是 2026-11-22，用户位于杭州')
    assert.equal(answer.model, 'deepseek-flash')
    assert.equal(answer.prefix, true)
  }
})

test('置顶是本地偏好，往返不还原', () => {
  assert.equal(roundTrip(sample()).pinned, undefined)
})

test('官方包（没有扩展字段）照样能导入，只是少压缩与用量', () => {
  const file = toSessionFile(sample(), () => null)
  const bare = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
  delete bare.ds_chat
  for (const message of bare.messages as Record<string, unknown>[]) {
    delete message.ds_chat
  }
  const restored = toLocalSession(readSessionFile(bare)).session
  assert.equal(restored.messages.length, 5)
  assert.equal(restored.compaction, undefined)
  const answer = restored.messages.find((message) => message.role === 'assistant')
  assert.equal(answer?.role === 'assistant' ? answer.usage : 'x', undefined)
  assert.equal(answer?.role === 'assistant' ? answer.prefix : 'x', false)
})

test('扩展字段坏掉时只丢扩展，不影响整份导入', () => {
  const file = toSessionFile(sample(), () => null)
  const broken = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
  broken.ds_chat = { version: 1, compaction: { summary: 42 } }
  const restored = toLocalSession(readSessionFile(broken as never)).session
  assert.equal(restored.messages.length, 5)
  assert.equal(restored.compaction, undefined)
})
