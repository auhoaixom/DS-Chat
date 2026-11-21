import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, useChatStore } from '../src/services/chat/store.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

/**
 * 地基：假 IndexedDB 让 store 真的能初始化。
 * 这一条挂了，后面所有 store 场景测试都没有意义。
 */
test('initChat 在 Node 里能初始化成功', async () => {
  await initChat()
  const state = useChatStore.getState()
  assert.equal(state.initError, false)
  assert.equal(state.ready, true)
  assert.deepEqual(state.sessions, [])
})

test('会话能写进去再读出来（真实 IndexedDB 实现）', async () => {
  await initChat()
  const session = {
    id: 'session-1',
    title: '测试会话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'm1')],
  }
  await db.saveSession(session)

  const loaded = await db.loadSession('session-1')
  assert.equal(loaded?.title, '测试会话')
  assert.equal(loaded?.messages.length, 1)

  await db.saveSession({ ...session, title: '改名了' })
  const summaries = await db.loadSessionSummaries()
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].title, '改名了')
})
