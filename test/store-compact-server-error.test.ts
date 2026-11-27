import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { compactSession, initChat, selectSession, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { conversation } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 服务端 5xx：仍然是「压缩失败，请稍后再试」。
 *
 * 跟 401 那条是一对——分开测是为了钉住"别把所有错误都说成 key 有问题"。
 * 一个用例一个文件：store 层是模块级单例，同一文件跑两次 initChat 会互相污染。
 */

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 2000; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

test('摘要请求 500：压缩返回 failed，不会被误报成 key 的问题', async () => {
  const session = {
    id: 'b',
    title: '服务端炸了',
    createdAt: 1,
    updatedAt: 1,
    messages: conversation(6),
  }
  await db.saveSession(session)
  await initChat()
  setApiKey('test-key')
  selectSession('b')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'b'), 'B 读进缓存')

  const server = startScriptedFetch(() => ({ kind: 'error', status: 500, message: 'boom' }))
  let result: string
  try {
    result = await compactSession('b')
  } finally {
    server.restore()
  }

  assert.equal(result, 'failed', `500 仍该是 failed，实际 ${result}`)
})
