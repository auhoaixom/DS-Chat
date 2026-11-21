import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, replaceHistory, selectSession, useChatStore } from '../src/services/chat/store.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

/**
 * 导入会整体换掉本地数据并递增 historyEpoch。
 * 如果导入前发起的那次读取在导入之后才回来，它拿的是旧世界的数据，
 * 绝不能写进新世界的缓存 —— 否则会看到一条"本不该存在"的对话。
 */
test('导入期间迟到的读取结果必须被丢弃', async () => {
  await db.saveSession({
    id: 'a',
    title: '会被导入冲掉的对话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()

  // 开始读 A（不 await），趁它还在路上就把本地数据整体换掉
  selectSession('a')
  await replaceHistory(async () => {})

  // 给迟到的读取足够时间发生
  await new Promise((resolve) => setTimeout(resolve, 200))

  const state = useChatStore.getState()
  assert.equal(Object.hasOwn(state.sessionCache, 'a'), false)
  assert.equal(state.sessions.length, 0)
  assert.equal(state.sessionLoadErrors.a, undefined)
})
