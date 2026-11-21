import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cancelCompaction,
  compactSession,
  initChat,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import * as db from '../src/services/chat/db.js'
import { assistantMessage, userMessage } from './helpers.js'
import { startFakeStream } from './fakeStream.js'

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

/**
 * 一次压缩还没结束时再点一次，必须拿不到第二把锁（返回 busy）。
 * 两次压缩同时跑会互相覆盖会话里的压缩记录。
 */
test('正在压缩时再点压缩返回 busy', async () => {
  await db.saveSession({
    id: 'a',
    title: '要压缩的对话',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'a-m1'),
      assistantMessage('第一答', 'a-m2'),
      userMessage('第二问', 'a-m3'),
      assistantMessage('第二答', 'a-m4'),
      userMessage('第三问', 'a-m5'),
      assistantMessage('第三答', 'a-m6'),
    ],
  })
  await initChat()
  setApiKey('test-key')

  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  // 压缩请求挂在假流上不返回，第一条压缩会一直处于「进行中」
  const stream = startFakeStream()
  const first = compactSession('a')
  try {
    await waitFor(() => Boolean(useChatStore.getState().compacting.a), '压缩已经开始')

    assert.equal(await compactSession('a'), 'busy')

    // 取消要真的打到那条请求上：`compactSession` 在 signal 被中止时返回 empty
    cancelCompaction('a')
    assert.equal(await first, 'empty')
  } finally {
    stream.restore()
    await waitFor(() => !useChatStore.getState().compacting.a, '压缩状态已清理')
  }

  // 取消之后不应该留下压缩记录
  assert.equal(useChatStore.getState().sessionCache.a.compaction, undefined)
})
