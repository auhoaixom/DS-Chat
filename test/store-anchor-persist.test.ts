import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { initChat, selectSession, undoCompaction, useChatStore } from '../src/services/chat/store.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 撤销时挂上的锚点必须落进库：杀掉 App 重开之后，面板还得是压缩前的那个数。
 * 只在内存里生效的话，用户重开一次就又看到那个偏低的数。
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

const usageOf = (input: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 5,
})

test('撤销之后重开：锚点还在，数字不变', async () => {
  const key = requestKeyOf({ model: useSettings.getState().model, hasFiles: false })
  await db.saveSession({
    id: 'a',
    title: '重开',
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
        blocks: [{ type: 'text', text: '大回答' }],
        usage: usageOf(8_000),
        promptEstimate: 1_000,
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
        blocks: [{ type: 'text', text: '短回答' }],
        usage: usageOf(300),
        promptEstimate: 280,
        estimateVersion: 2,
        requestKey: key,
      },
    ],
    compaction: {
      summary: '摘要',
      coveredIds: ['a-m1', 'a-big'],
      createdAt: 3,
      mode: 'manual',
      beforeTokens: 900,
      afterTokens: 90,
      model: null,
      anchorId: 'a-big',
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  undoCompaction('a')
  assert.equal(useChatStore.getState().sessionCache.a?.anchorId, 'a-big')

  // 等落盘，然后直接读库：这是"重开 App"时唯一还在的东西
  await waitFor(() => true, '占位')
  for (let i = 0; i < 100; i += 1) {
    const stored = await db.loadSession('a')
    if (stored?.anchorId === 'a-big' && stored.compaction === undefined) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const stored = await db.loadSession('a')
  assert.equal(stored?.anchorId, 'a-big', '锚点要落盘，否则重开就丢了')
  assert.equal(stored?.compaction, undefined, '压缩记录要一起删掉')
})
