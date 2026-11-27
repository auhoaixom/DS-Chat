import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage, requestKeyOf, requestShapeOf } from '../src/services/chat/compaction.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { useSettings } from '../src/services/settings.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { compactionRecord, imageFile, userMessage } from './helpers.js'

/**
 * v1.6.8 修的是"附件全被压缩覆盖"那一半：`hasFiles` 必须按**真正进请求**的消息算，
 * 用全部可见消息算的话，压缩一次之后指纹永远是 f:1、发送时算出来却是 f:0，
 * 锚点被永久丢弃、面板卡在「估算」。
 *
 * 这里守的是反过来的另一半：只有**部分**附件被压掉、另一些还留在请求里时，
 * `hasFiles` 必须是 true。错了的症状和刚修那个一模一样，而且更难发现
 * ——压掉的正好是早的那批，看着"都压干净了"，其实后面还挂着附件。
 */

const keyOf = (hasFiles: boolean) =>
  requestKeyOf({ model: useSettings.getState().model, hasFiles })

/** 带一条已上传附件（serverId 非空才会进请求）的提问 */
const withFile = (id: string, text: string, serverId: string) => ({
  ...userMessage(text, id),
  files: [{ ...imageFile(`${id}-f`), serverId }],
})

const answered = (id: string, createdAt: number, text: string, hasFiles: boolean) => ({
  id,
  role: 'assistant' as const,
  createdAt,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text }],
  usage: {
    input_tokens: 9_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 10,
  },
  promptEstimate: 8_000,
  estimateVersion: ESTIMATE_VERSION,
  requestKey: keyOf(hasFiles),
})

const sessionOf = (messages: Message[], compaction?: Session['compaction']): Session => ({
  id: 's1',
  title: '附件邻居',
  createdAt: 0,
  updatedAt: 0,
  messages,
  compaction,
})

test('压缩只吃掉前面那批附件时，后面还挂着的附件仍算进请求形状', () => {
  const first = withFile('u1', '看这张图', 'file-a')
  const firstAnswer = answered('a1', 100, '看到了', true)
  const second = withFile('u2', '再看这张', 'file-b')
  // 这条回复是在"请求里还有 file-b"的形状下发出的
  const secondAnswer = answered('a2', 400, '也看到了', true)
  const session = sessionOf(
    [first, firstAnswer, second, secondAnswer],
    // 只覆盖前两条：file-b 还留在请求里
    compactionRecord({ coveredIds: ['u1', 'a1'], createdAt: 300, summary: '被压掉的旧附件对话' })
  )

  assert.equal(requestShapeOf(session).hasFiles, true, 'file-b 还在请求里，形状必须是 f:1')

  const usage = getContextUsage(session)
  assert.ok(usage)
  assert.equal(usage.compacted, true, '前提：这次压缩是真的生效了')
  assert.equal(usage.anchor, 'measured', '指纹对得上，锚点不该被丢弃')
  assert.equal(usage.anchorId, 'a2')
})

test('附件全被压缩吃掉时形状回到纯文字，指纹跟着变', () => {
  const first = withFile('u1', '看这张图', 'file-a')
  const firstAnswer = answered('a1', 100, '看到了', true)
  const second = withFile('u2', '再看这张', 'file-b')
  const secondAnswer = answered('a2', 400, '也看到了', true)
  const third = userMessage('那总结一下', 'u3')
  // 这条回复是在"附件都被压掉了"的形状下发出的
  const thirdAnswer = answered('a3', 600, '总结如下', false)
  const session = sessionOf(
    [first, firstAnswer, second, secondAnswer, third, thirdAnswer],
    compactionRecord({
      coveredIds: ['u1', 'a1', 'u2', 'a2'],
      createdAt: 500,
      summary: '被压掉的两轮附件对话',
    })
  )

  assert.equal(requestShapeOf(session).hasFiles, false, '请求里已经没有附件了')
  const usage = getContextUsage(session)
  assert.ok(usage)
  assert.equal(usage.anchor, 'measured')
  assert.equal(usage.anchorId, 'a3')
})
