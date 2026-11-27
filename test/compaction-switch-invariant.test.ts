import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage, requestKeyOf } from '../src/services/chat/compaction.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import type { AssistantMessage, Message, Session } from '../src/services/chat/types.js'
import { useSettings } from '../src/services/settings.js'
import { compactionRecord, imageFile, userMessage } from './helpers.js'

/**
 * 点「深度思考」「智能搜索」不该让面板的数字动——那两个开关要么只改输出行为，
 * 要么只多一组工具声明，不值得把整个数换成另一种算法。
 */
const reply = (createdAt: number): AssistantMessage => ({
  id: `a-${createdAt}`,
  role: 'assistant',
  createdAt,
  model: null,
  prefix: true,
  status: 'done',
  blocks: [{ type: 'text', text: '答' }],
  usage: {
    input_tokens: 9_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1_000,
    output_tokens: 10,
  },
  promptEstimate: 1_000,
  estimateVersion: ESTIMATE_VERSION,
  requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: false }),
})

const sessionOf = (messages: Message[], compaction?: Session['compaction']): Session => ({
  id: 's',
  title: '测试',
  createdAt: 0,
  updatedAt: 0,
  messages,
  ...(compaction ? { compaction } : {}),
})

test('请求指纹里不含开关，只含模型与附件', () => {
  const key = requestKeyOf({ model: 'deepseek-flash', hasFiles: false })
  assert.match(key, /^m:deepseek-flash\|f:0\|p:\d+\|e:\d+$/)
  assert.ok(!key.includes('t:'), '不该有 thinking 段')
  assert.ok(!key.includes('s:'), '不该有 search 段')
})

test('翻开关前后，整个用量对象逐字段不变', () => {
  const messages = [userMessage('问'), reply(100)]
  const before = getContextUsage(sessionOf(messages))
  const original = useSettings.getState()
  try {
    useSettings.setState({ thinking: !original.thinking, search: !original.search })
    const after = getContextUsage(sessionOf(messages))
    assert.ok(before && after)
    // 深比较：连 anchor / anchorId / 诊断字段一起，一个都不许变
    assert.deepEqual(after, before)
    assert.equal(after.anchor, 'measured')
  } finally {
    useSettings.setState({ thinking: original.thinking, search: original.search })
  }
})

test('换模型仍然要失效——别为了"不跳"把该失效的也放过', () => {
  // 这条回复是在另一个模型下发的：形状对不上，就不该拿它当基准
  const answered = { ...reply(100), requestKey: requestKeyOf({ model: 'deepseek-v4-pro', hasFiles: false }) }
  const usage = getContextUsage(sessionOf([userMessage('问'), answered]))
  assert.ok(usage)
  assert.equal(usage.anchorDropReason, 'request')
  assert.equal(usage.anchorId, null)
})

test('上下文里多了附件，锚点也要失效', () => {
  const answered = reply(100)
  const withFile = { ...userMessage('问'), files: [{ ...imageFile(), serverId: 'file-1' }] }
  const usage = getContextUsage(sessionOf([withFile, answered]))
  assert.ok(usage)
  assert.equal(usage.anchorDropReason, 'request')
})

test('附件被压缩覆盖之后，锚点要重新成立（hasFiles 按请求实际内容算）', () => {
  /**
   * 这一条盯的是一个真出过的 bug：`requestShapeOf` 原来拿**全部可见消息**算 hasFiles，
   * 而被压缩覆盖的消息根本不进请求。于是压缩一过，指纹永远对不上，
   * 锚点被永久丢弃、面板从此卡在「估算」——实测在真机上就是这么发现的。
   */
  const withFile = { ...userMessage('问'), files: [{ ...imageFile(), serverId: 'file-1' }] }
  const answeredWithFile = {
    ...reply(100),
    requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: true }),
  }
  const ask = { ...userMessage('再问'), createdAt: 150 }
  // 压缩后那次请求不再带附件，指纹是 f:0
  const afterCompaction = {
    ...reply(200),
    requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: false }),
  }
  const usage = getContextUsage(
    sessionOf(
      [withFile, answeredWithFile, ask, afterCompaction],
      compactionRecord({ coveredIds: [withFile.id, answeredWithFile.id], createdAt: 150 })
    )
  )
  assert.ok(usage)
  assert.equal(usage.anchor, 'measured', '压缩后应当仍然能锚定')
  assert.equal(usage.anchorId, afterCompaction.id)
})
