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
 * 内存里只留最近 5 条会话（SESSION_CACHE_LIMIT），超了就从最久没用的开始踢。
 * 这里守的是「踢谁都可以，就是不能踢用户正在看的那条」—— 踢错了界面会闪回加载态。
 */
test('缓存淘汰不会踢掉当前打开的会话', async () => {
  for (let i = 1; i <= 7; i += 1) {
    await db.saveSession({
      id: `s${i}`,
      title: `对话 ${i}`,
      createdAt: i,
      updatedAt: i,
      messages: [userMessage(`内容 ${i}`, `s${i}-m1`)],
    })
  }
  await initChat()

  // 依次打开 6 条，最后停在 s6：缓存上限是 5，必然发生淘汰
  for (let i = 1; i <= 6; i += 1) {
    selectSession(`s${i}`)
    await waitFor(
      () => Object.hasOwn(useChatStore.getState().sessionCache, `s${i}`),
      `s${i} 读进缓存`,
    )
  }

  const state = useChatStore.getState()
  assert.equal(state.activeId, 's6')
  assert.equal(
    Object.hasOwn(state.sessionCache, 's6'),
    true,
    '当前打开的会话被淘汰了：界面会闪回加载态',
  )
  assert.ok(
    Object.keys(state.sessionCache).length <= 5,
    `缓存超上限：${Object.keys(state.sessionCache).length}`,
  )
})
