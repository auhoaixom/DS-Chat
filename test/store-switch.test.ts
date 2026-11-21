import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, selectSession, useChatStore } from '../src/services/chat/store.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

/**
 * 手快连点两条对话：切换只改变 activeId，但两条都该正常读进缓存，
 * 而且先发起的读取回来时不能把界面切回 A。
 */
test('连点两条对话：activeId 停在最后点的那条，两条都进缓存', async () => {
  for (const [id, title] of [
    ['a', 'A'],
    ['b', 'B'],
  ] as const) {
    await db.saveSession({
      id,
      title,
      createdAt: 1,
      updatedAt: 1,
      messages: [userMessage(`${title} 的消息`, `${id}-m1`)],
    })
  }
  await initChat()

  selectSession('a')
  selectSession('b')

  await waitFor(
    () =>
      Object.hasOwn(useChatStore.getState().sessionCache, 'a') &&
      Object.hasOwn(useChatStore.getState().sessionCache, 'b'),
    'A 和 B 都读进缓存',
  )
  const state = useChatStore.getState()
  assert.equal(state.activeId, 'b')
  assert.equal(state.sessionCache.a.title, 'A')
  assert.equal(state.sessionCache.b.title, 'B')
})
