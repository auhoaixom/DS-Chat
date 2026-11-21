import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMessageEvent } from '../src/services/api/parseEvent.js'
import { applyEvent, canContinueReply, settleReply } from '../src/services/chat/reply.js'
import type { AssistantMessage, ReplyBlock } from '../src/services/chat/types.js'

/**
 * 拒答收尾：服务端以 stop_reason: 'refusal' 结束时，已经流式下发的思考与正文
 * 按协议要求由客户端丢弃，只保留工具块。这条路径在真机上极难复现
 * （v0.9.7 起不再声明 safety_check，服务端不再审输入输出），所以只能靠单测钉住。
 */
const toolBlock: ReplyBlock = {
  type: 'server_tool_use',
  id: 'srvtoolu_s_1_deadbeef',
  name: 'deepseek_web_search',
  input: { action: 'search', queries: ['tea'] },
  caller: { type: 'direct' },
  kind: 'search',
}

const base = (over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 1,
  model: 'deepseek-flash',
  prefix: true,
  status: 'streaming',
  blocks: [
    { type: 'thinking', thinking: '推理过程', startedAt: 10 },
    { type: 'text', text: '不完整的回答' },
    toolBlock,
  ],
  ...over,
})

test('拒答时丢弃思考与正文，只保留工具块', () => {
  const settled = settleReply(base({ stopReason: 'refusal' }), 'done', 99)
  assert.equal(settled.status, 'done')
  assert.deepEqual(
    settled.blocks.map((block) => block.type),
    ['server_tool_use']
  )
})

test('拒答时也不会再给被丢弃的思考块补结束时间', () => {
  const settled = settleReply(base({ stopReason: 'refusal' }), 'done', 99)
  // 思考块整个没了，不应该留下一个被补了 endedAt 的残块
  assert.equal(settled.blocks.some((block) => block.type === 'thinking'), false)
})

test('正常结束时保留全部内容，未结束的思考块用当前时间收尾', () => {
  const settled = settleReply(base({ stopReason: 'end_turn' }), 'done', 99)
  assert.deepEqual(
    settled.blocks.map((block) => block.type),
    ['thinking', 'text', 'server_tool_use']
  )
  const thinking = settled.blocks[0]
  assert.equal(thinking?.type, 'thinking')
  assert.equal(thinking.type === 'thinking' ? thinking.endedAt : undefined, 99)
})

test('出错收尾保留内容，并把 error 记在回复上', () => {
  const settled = settleReply(base(), 'error', 50, { kind: 'network', message: 'Failed to fetch' })
  assert.equal(settled.status, 'error')
  assert.equal(settled.error?.kind, 'network')
  assert.equal(settled.blocks.length, 3)
})

test('被拒答的回复不能继续生成，工具调用与模板提示同样不能', () => {
  assert.equal(canContinueReply({ ...base(), status: 'stopped', stopReason: 'refusal' }), false)
  assert.equal(
    canContinueReply({ ...base({ blocks: [toolBlock] }), status: 'stopped', stopReason: 'max_tokens' }),
    false
  )
  assert.equal(
    canContinueReply({
      ...base({ blocks: [{ type: 'text', text: '提示', isTemplate: true }] }),
      status: 'stopped',
      stopReason: 'max_tokens',
    }),
    false
  )
  // 对照组：正常停止的纯文本回复可继续
  assert.equal(
    canContinueReply({ ...base({ blocks: [{ type: 'text', text: '写到一半' }] }), status: 'stopped' }),
    true
  )
})

/**
 * 用量合并：输入侧只在 message_start 里出现，输出侧在 message_delta 里累计。
 * 这里钉住的是「delta 只带输出侧时，绝不能把 start 报的输入侧洗成 0」——
 * 0.9.6 排查"系统提示词 1"时正是因为怀疑这一点才绕了远路。
 */
const startUsage = {
  input_tokens: 900,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 100,
  output_tokens: 0,
}

const applied = (events: unknown[]): AssistantMessage => {
  let reply = base({ blocks: [] })
  const indexes = new Map<number, number>()
  for (const [index, raw] of events.entries()) {
    const event = readMessageEvent(raw)
    assert.ok(event, `事件 ${index} 解析失败`)
    reply = applyEvent(reply, event, index, indexes)
  }
  return reply
}

test('message_delta 只带输出侧时，message_start 的输入侧原样保留', () => {
  const reply = applied([
    { type: 'message_start', message: { id: 'msg_1', model: 'deepseek-flash', usage: startUsage } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
  ])
  assert.equal(reply.usage?.input_tokens, 900)
  assert.equal(reply.usage?.cache_read_input_tokens, 100)
  // 已知取舍：字段不全的 delta 被整份丢弃，所以这一轮的输出侧读不到（服务端实际会回全量）
  assert.equal(reply.usage?.output_tokens, 0)
})

test('message_delta 带全四个数字时整体替换用量', () => {
  const reply = applied([
    { type: 'message_start', message: { id: 'msg_1', model: 'deepseek-flash', usage: startUsage } },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { ...startUsage, output_tokens: 42 },
    },
  ])
  assert.deepEqual(reply.usage, { ...startUsage, output_tokens: 42 })
})
