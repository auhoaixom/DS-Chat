import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import {
  compactSession,
  initChat,
  selectSession,
  undoCompaction,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation, roundTrip } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 在导入的会话上压缩之后再撤销。
 *
 * 撤销要做一件事：把面板的基准指回"压缩前那条带实测的回复"。
 * 可这条会话里**没有**任何本机锚点（导入的回复只有服务端用量，没有本机口径戳），
 * 所以这里必须什么都不挂——挂一个指不到的 id，面板会退回常规查找，
 * 从此拿压缩后那次小请求当基准（26% 就是这么来的）。
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

test('导入的会话上撤销压缩：不挂野锚点，面板回到压缩前的估算值', async () => {
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
  await db.saveSession(
    roundTrip({ id: 'a', title: '导入后撤销', createdAt: 1, updatedAt: 1, messages })
  )
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const beforeCompaction = getContextUsage(useChatStore.getState().sessionCache.a as never)
  assert.ok(beforeCompaction)

  const server = startScriptedFetch(() => ({ kind: 'text', text: '## 用户目标与背景\n摘要' }))
  try {
    assert.equal(await compactSession('a'), 'done', '前提：压缩成功')
  } finally {
    server.restore()
  }

  undoCompaction('a')

  const session = useChatStore.getState().sessionCache.a
  assert.equal(session?.compaction, undefined, '压缩记录要删干净')

  /**
   * 撤销会顺手挂上"压缩前那条带实测的回复"。导入的回复也有服务端用量，
   * 所以这里确实会挂一个 id——但它缺本机口径戳，进到 `measureContext` 就被丢掉，
   * 面板不会因此假装有实测。真正要守住的是"别让它变成一个能生效的基准"。
   */
  const after = getContextUsage(session)
  assert.ok(after)
  assert.equal(after.anchor, 'dropped', '挂上的锚点必须是失效的，不许生效')
  assert.equal(after.anchorId, null)
  assert.equal(after.compacted, false, '摘要那一行要整行消失')
  assert.equal(after.summaryTokens, 0)
  assert.equal(after.measured, false)
  // 原文全回来、数回到压缩前那个值：撤销是一次真正的回退，不是"换个数"
  assert.equal(after.used, beforeCompaction.used)
})
