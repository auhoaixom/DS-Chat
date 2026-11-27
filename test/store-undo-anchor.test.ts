import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage, requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { initChat, selectSession, undoCompaction, useChatStore } from '../src/services/chat/store.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import type { Session } from '../src/services/chat/types.js'
import { userMessage } from './helpers.js'

/**
 * 撤销压缩之后，面板必须按「压缩前那条回复」算，而不是压缩后那次小请求。
 * 后者算出来是"小实测 + 按字数估回来的原文"，就是那个 26%。
 */
const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

const session = (): Session | undefined => useChatStore.getState().sessionCache.a

const usageOf = (input: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 5,
})

test('撤销压缩把锚点接过来，数字回到压缩前那条', async () => {
  const key = requestKeyOf({ model: useSettings.getState().model, hasFiles: false })
  await db.saveSession({
    id: 'a',
    title: '撤销锚点',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'a-m1'),
      {
        id: 'a-big',
        role: 'assistant',
        createdAt: 2,
        model: null,
        prefix: true,
        status: 'done',
        blocks: [{ type: 'text', text: '第一大段回答' }],
        usage: usageOf(9_000),
        promptEstimate: 1_200,
        estimateVersion: 2,
        requestKey: key,
      },
      userMessage('第二问', 'a-m3'),
      {
        id: 'a-small',
        role: 'assistant',
        createdAt: 4,
        model: null,
        prefix: true,
        status: 'done',
        blocks: [{ type: 'text', text: '压缩后的短回答' }],
        usage: usageOf(400),
        promptEstimate: 300,
        estimateVersion: 2,
        requestKey: key,
      },
    ],
    compaction: {
      summary: '压缩摘要',
      coveredIds: ['a-m1', 'a-big'],
      createdAt: 3,
      mode: 'manual',
      beforeTokens: 1_000,
      afterTokens: 100,
      model: null,
      anchorId: 'a-big',
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  undoCompaction('a')
  const after = session()
  assert.ok(after)
  assert.equal(after.compaction, undefined, '记录要删掉')
  assert.equal(after.anchorId, 'a-big', '锚点接过来')

  const usage = getContextUsage(after)
  assert.ok(usage)
  assert.equal(usage.anchor, 'measured')
  assert.equal(usage.anchorId, 'a-big')
  // 压缩前那条实测 9000，而不是压缩后那条的 400
  assert.equal(usage.anchorUsed, 9_000)
})
