import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyCompaction,
  estimateRequestTokens,
  getContextUsage,
  getCoveredCount,
  requestKeyOf,
} from '../src/services/chat/compaction.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { useSettings } from '../src/services/settings.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { at, compactionRecord, conversation, userMessage } from './helpers.js'

/**
 * 边界数值：这些数直接印在面板上，错一点用户就会以为自己的会话出事了。
 * 全都是"不会崩、不会出现负数、不会除零"的守门用例。
 */

const sessionOf = (messages: Message[], compaction?: Session['compaction']): Session => ({
  id: 's1',
  title: '边界',
  createdAt: 0,
  updatedAt: 0,
  messages,
  compaction,
})

const keyOf = () => requestKeyOf({ model: useSettings.getState().model, hasFiles: false })

/** 一条"服务端说占了 usage 个 token"的回复，用来凭空把占用顶到任意高度 */
const measuredReply = (usage: number, messages: Message[]) => ({
  id: 'a-anchor',
  role: 'assistant' as const,
  createdAt: 2,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text: '答' }],
  usage: {
    input_tokens: usage,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 10,
  },
  promptEstimate: estimateRequestTokens(messages),
  estimateVersion: ESTIMATE_VERSION,
  requestKey: keyOf(),
})

test('超过窗口时百分比封顶 100，但真实用量不被截断', () => {
  const messages = conversation(2)
  const session = sessionOf([...messages, measuredReply(1_200_000, messages)])
  const usage = getContextUsage(session)
  assert.ok(usage)
  assert.equal(usage.window, 1_048_576)
  assert.equal(usage.percent, 100, '进度环封顶，不能显示 114%')
  assert.ok(usage.used > usage.window, `真实用量要照实给出，实际 ${usage.used}`)
  // 封顶只影响百分比，明细之和仍等于那个超过 100% 的真实值
  assert.equal(
    usage.messageTokens + usage.systemTokens + usage.summaryTokens + usage.overheadTokens,
    usage.used
  )
})

test('压缩后几乎归零：不出现负数，四行明细之和仍等于合计', () => {
  const messages = conversation(3)
  const covered = messages.map((message) => message.id)
  const session = sessionOf(
    messages,
    // 摘要只有几个字：留下的一点点占用要真的接近 0，而不是被算成负数
    compactionRecord({ coveredIds: covered, createdAt: 10, summary: '好' })
  )
  const usage = getContextUsage(session, '')
  assert.ok(usage)
  assert.equal(usage.compacted, true)
  assert.ok(usage.used >= 0, `占用不许是负数，实际 ${usage.used}`)
  assert.ok(usage.messageTokens >= 0, `对话消息那一项不许是负数，实际 ${usage.messageTokens}`)
  assert.ok(usage.summaryTokens >= 0)
  assert.ok(usage.systemTokens >= 0)
  assert.ok(usage.overheadTokens >= 0)
  assert.equal(
    usage.messageTokens + usage.systemTokens + usage.summaryTokens + usage.overheadTokens,
    usage.used
  )
  assert.equal(usage.percent, 0)
})

test('摘要是空串：不崩，摘要那一项为 0，但仍算压缩状态', () => {
  const messages = conversation(2)
  const session = sessionOf(
    messages,
    compactionRecord({ coveredIds: messages.map((message) => message.id), createdAt: 10, summary: '' })
  )
  const usage = getContextUsage(session, '系统提示')
  assert.ok(usage)
  assert.equal(usage.summaryTokens, 0, '空摘要不该凭空占一堆 token')
  assert.equal(usage.compacted, true, '记录存在就算压缩状态（卡片还得显示它）')
  assert.equal(usage.percent, 0)
  assert.equal(
    usage.messageTokens + usage.systemTokens + usage.summaryTokens + usage.overheadTokens,
    usage.used
  )
})

test('覆盖了全部消息时撤销：原文全回来、摘要那行消失、数回到压缩前', () => {
  const messages = conversation(3)
  const before = getContextUsage(sessionOf(messages), '系统提示')
  const compacted = sessionOf(
    messages,
    compactionRecord({
      coveredIds: messages.map((message) => message.id),
      createdAt: 10,
      summary: '旧内容全被压掉了',
    })
  )

  // 压缩期间：请求里一条原文都没有，界面上全藏起来
  const applied = applyCompaction(messages, compacted.compaction)
  assert.deepEqual(applied.history, [])
  assert.equal(getCoveredCount(messages, compacted.compaction), messages.length)

  // 撤销 = 把记录删掉（store 的 undoCompaction 做的就是这件事）
  const after = getContextUsage(sessionOf(messages), '系统提示')
  assert.ok(before && after)
  assert.equal(after.compacted, false)
  assert.equal(after.summaryTokens, 0)
  assert.equal(after.used, before.used, '撤销是一次真正的回退，不是"换个数"')
  assert.equal(after.percent, before.percent)
})

test('模型认不出时退回默认窗口，不除零', () => {
  const original = useSettings.getState().model
  try {
    useSettings.setState({ model: '完全没听说过的模型' })
    const messages = [userMessage('问'), at(conversation(1), 1)]
    const usage = getContextUsage(sessionOf(messages))
    assert.ok(usage)
    assert.equal(usage.window, 1_048_576, '认不出就用默认窗口')
    assert.ok(Number.isFinite(usage.percent))
    assert.ok(usage.percent >= 0 && usage.percent <= 100)
  } finally {
    useSettings.setState({ model: original })
  }
})
