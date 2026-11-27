import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  initChat,
  selectMessageVersion,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 硬性规定：不许在覆盖段内部岔分支。
 *
 * 切版本的"目标"必然是兄弟版本、不在当前路径上，所以判据不是它自己，
 * 而是**岔口在哪**：岔口落在覆盖段内部 → 覆盖段后半截离开路径、摘要讲错；
 * 岔口落在末尾或保留段 → 覆盖段原样不动，照常允许。
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

const reply = (id: string, text: string) => ({
  id,
  role: 'assistant' as const,
  createdAt: 0,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text }],
})

test('覆盖段内部的版本切不过去，保留段内部照常能切', async () => {
  await db.saveSession({
    id: 'a',
    title: '切不得',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { ...userMessage('第一问', 'u1'), parentId: null, selectedChildId: 'a1' },
      { ...reply('a1', '第一答'), parentId: 'u1', selectedChildId: 'u2' },
      { ...reply('a1b', '第一答（另一版）'), parentId: 'u1' },
      { ...userMessage('第二问', 'u2'), parentId: 'a1', selectedChildId: 'a2' },
      { ...reply('a2', '第二答'), parentId: 'u2' },
      { ...reply('a2b', '第二答（另一版）'), parentId: 'u2' },
    ],
    compaction: {
      summary: '第一问第一答被压掉了',
      coveredIds: ['u1', 'a1'],
      createdAt: 10,
      mode: 'manual',
      beforeTokens: 1_000,
      afterTokens: 100,
      model: null,
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  selectMessageVersion('a', 'a1b')
  const after = useChatStore.getState().sessionCache.a
  assert.ok(after)
  assert.equal(
    after.messages.find((message) => message.id === 'u1')?.selectedChildId,
    'a1',
    '覆盖段内部不许岔分支：选中项必须还在 a1'
  )

  // 对照：保留段里的版本照常能切（岔口在 u2，覆盖段不动）
  selectMessageVersion('a', 'a2b')
  assert.equal(
    useChatStore.getState().sessionCache.a?.messages.find((message) => message.id === 'u2')
      ?.selectedChildId,
    'a2b'
  )
})
