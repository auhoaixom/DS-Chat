import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { initChat, selectSession, undoCompaction, useChatStore } from '../src/services/chat/store.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * `Compaction.anchorId` 是后加的字段，老记录没有。
 * 撤销老记录时要按"早于压缩时间"找回压缩前那条，否则又会落到压缩后的小实测上。
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

test('老记录没有 anchorId 时，按时间找回压缩前那条', async () => {
  const key = requestKeyOf({ model: useSettings.getState().model, hasFiles: false })
  await db.saveSession({
    id: 'b',
    title: '老记录',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'b-m1'),
      {
        id: 'b-big',
        role: 'assistant',
        createdAt: 2,
        model: null,
        prefix: true,
        status: 'done',
        blocks: [{ type: 'text', text: '回答' }],
        usage: usageOf(7_000),
        promptEstimate: 900,
        estimateVersion: 2,
        requestKey: key,
      },
      userMessage('第二问', 'b-m3'),
      {
        id: 'b-small',
        role: 'assistant',
        createdAt: 4,
        model: null,
        prefix: true,
        status: 'done',
        blocks: [{ type: 'text', text: '短回答' }],
        usage: usageOf(300),
        promptEstimate: 200,
        estimateVersion: 2,
        requestKey: key,
      },
    ],
    compaction: {
      summary: '摘要',
      coveredIds: ['b-m1', 'b-big'],
      createdAt: 3,
      mode: 'manual',
      beforeTokens: 900,
      afterTokens: 80,
      model: null,
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('b')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'b'), 'B 读进缓存')

  undoCompaction('b')
  assert.equal(useChatStore.getState().sessionCache.b?.anchorId, 'b-big')
})
