import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { compactSession, initChat, selectSession, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation, roundTrip } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 在**导入的会话**上点「压缩上下文」。
 *
 * 导入包只带官方字段 + 我们自己的扩展，**没有**本机口径（`estimateVersion` / `requestKey`），
 * 所以导入的回复一律当不了锚点，面板只能是估算——这是设计，不是 bug。
 * 但"在这种会话上压缩"这条路一次没走过：`buildCompaction` 拿不到 `servedModel`、
 * `anchorIdOf` 找不到锚点，任一假设不成立就会当场崩在用户脸上。
 */

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 2000; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

test('导入的会话上压缩：不崩、覆盖段都指得到、面板明说是估算', async () => {
  /**
   * 导入的真实形态：**用量跟着包一起过来**（它是官方字段），
   * 但"这把尺子是什么版本""当时请求长什么样"是本机口径，包里没有。
   */
  const messages = longConversation().map((message) =>
    message.role === 'assistant'
      ? {
          ...message,
          usage: {
            input_tokens: 1_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 10,
          },
          promptEstimate: 900,
        }
      : message
  )
  const imported = roundTrip({
    id: 'a',
    title: '导入的会话',
    createdAt: 1,
    updatedAt: 1,
    messages,
  })
  await db.saveSession(imported)
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  // 压缩之前：导入的回复没有本机口径戳，本来就当不了锚点
  const before = getContextUsage(useChatStore.getState().sessionCache.a as never)
  assert.ok(before)
  assert.equal(before.measured, false)
  assert.equal(before.anchorDropReason, 'estimate', '导入的回复缺 estimateVersion，不该被当实测')

  const server = startScriptedFetch(() => ({ kind: 'text', text: '## 用户目标与背景\n导入后的摘要' }))
  let result: string
  try {
    result = await compactSession('a')
  } finally {
    server.restore()
  }

  assert.equal(result, 'done', `压缩该成功，实际 ${result}`)

  const session = useChatStore.getState().sessionCache.a
  assert.ok(session?.compaction, '压缩记录要写进去')
  assert.equal(session.compaction.mode, 'manual')
  assert.ok(session.compaction.summary.includes('导入后的摘要'))

  // 覆盖段里的 id 必须都能在当前消息里找到，否则界面会算不出要藏几条
  const ids = new Set(session.messages.map((message) => message.id))
  for (const id of session.compaction.coveredIds) {
    assert.ok(ids.has(id), `覆盖段里的 ${id} 在会话里不存在`)
  }

  const usage = getContextUsage(session)
  assert.ok(usage)
  assert.equal(usage.compacted, true, '压完了面板就得知道')
  /**
   * 压完之后锚点仍然被丢弃，原因从 `estimate` 换成 `compaction`：
   * 这两条都对（导入的回复没有本机口径戳、压缩又比所有回复都新），
   * 判定按顺序先命中 `compaction`。面板只关心"是估算"，原因只是诊断用。
   */
  assert.equal(usage.measured, false)
  assert.equal(usage.anchor, 'dropped')
  assert.equal(usage.anchorDropReason, 'compaction')
  assert.ok(usage.used > 0)
})
