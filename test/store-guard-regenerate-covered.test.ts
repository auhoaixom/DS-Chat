import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  initChat,
  regenerateReply,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { assistantMessage, userMessage } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 硬性规定：被压缩盖掉的回答不许重新生成。
 *
 * 重答会在那条提问下再加一个版本——覆盖段里的问答根本不进请求（由摘要代表），
 * 换掉其中一个只会让摘要继续描述一段已经不存在的对话。
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

test('重新生成覆盖段里的回答：什么都不发生，也不发请求', async () => {
  await db.saveSession({
    id: 'a',
    title: '重答不得',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'a-u1'),
      assistantMessage('第一答', 'a-a1'),
      userMessage('第二问', 'a-u2'),
      assistantMessage('第二答', 'a-a2'),
    ],
    compaction: {
      summary: '第一问第一答被压掉了',
      coveredIds: ['a-u1', 'a-a1'],
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

  const server = startScriptedFetch()
  try {
    const before = useChatStore.getState().sessionCache.a?.messages.length ?? 0
    regenerateReply('a', 'a-a1')
    assert.equal(
      useChatStore.getState().sessionCache.a?.messages.length,
      before,
      '被拒绝时不许追加新的回答版本'
    )
    assert.equal(server.calls.length, 0, '被拒绝时连请求都不该发')
    assert.equal(
      Object.hasOwn(useChatStore.getState().streaming, 'a'),
      false,
      '也不该有流在跑'
    )
  } finally {
    server.restore()
  }
})
