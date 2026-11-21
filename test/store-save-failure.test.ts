import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initChat,
  renameSession,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

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
 * 模拟磁盘写不进去：把 IndexedDB 的 put 改成抛错。
 *
 * 从这一层注入而不是给 store 加开关 —— 真实的失败就是 QuotaExceededError 这类
 * IndexedDB 抛出来的错，注入点越靠近真实现越好，而且生产代码一个字都不用改。
 */
const breakIndexedDbWrites = () => {
  const proto = globalThis.IDBObjectStore?.prototype
  assert.ok(proto, 'fake-indexeddb 没有提供 IDBObjectStore')
  const original = proto.put
  proto.put = function put() {
    throw new Error('模拟：磁盘写满了')
  }
  return () => {
    proto.put = original
  }
}

test('落盘失败会亮错误，重试成功后错误消失且数据真的进库', async () => {
  await db.saveSession({
    id: 'a',
    title: '原名',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()

  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const restore = breakIndexedDbWrites()
  try {
    renameSession('a', '改名失败的那次')
    await waitFor(
      () => useChatStore.getState().sessionSaveErrors.a === true,
      '落盘失败要亮错误',
    )

    // 内存里已经是新名字，但库里还是旧的：这正是「界面显示了、数据没落盘」的状态
    assert.equal(useChatStore.getState().sessionCache.a.title, '改名失败的那次')
    assert.equal((await db.loadSession('a'))?.title, '原名')
  } finally {
    restore()
  }

  retrySaveSessions()
  await waitFor(
    () => useChatStore.getState().sessionSaveErrors.a !== true,
    '重试之后错误要消失',
  )
  assert.equal((await db.loadSession('a'))?.title, '改名失败的那次')
})
