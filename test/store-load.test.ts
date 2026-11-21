import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, renameSession, selectSession, useChatStore } from '../src/services/chat/store.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

/** 轮询到条件成立，避免用固定 sleep 猜 IndexedDB 的时序（那样会时好时坏） */
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
 * 数据必须在 initChat 之前造好：`initChat` 是一次性的，会话清单只在初始化时读一遍，
 * 之后再往库里塞的会话不在清单里，读也读不进来。
 */
test('读取期间改名：旧读取回来不能把标题盖回去', async () => {
  await db.saveSession({
    id: 'a',
    title: '原名',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('第一条', 'a-m1')],
  })
  await initChat()

  // 开始读 A（不 await），紧接着改名：改名落在读取完成之前
  selectSession('a')
  renameSession('a', '读取期间改的名字')

  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')
  assert.equal(useChatStore.getState().sessionCache.a.title, '读取期间改的名字')
})
