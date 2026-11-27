import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { compactSession, initChat, selectSession, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { conversation } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 压缩时 API Key 无效：必须单独报「API Key 无效」，不能糊成「压缩失败，请稍后再试」。
 *
 * 这条是真机上撞出来的：探针把 key 覆盖成了假值，压缩一路 401，而界面只说"稍后再试"——
 * 谁看都以为是网络或服务端的问题，连我去查都先跑偏到了"请求体太大"。
 * 401 有个性质：重试永远没用，而用户自己能修（设置里换一把 key）。
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

test('摘要请求 401：压缩返回 auth，而不是 failed', async () => {
  const session = {
    id: 'a',
    title: '鉴权失败',
    createdAt: 1,
    updatedAt: 1,
    messages: conversation(6),
  }
  await db.saveSession(session)
  await initChat()
  setApiKey('bad-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch(() => ({
    kind: 'error',
    status: 401,
    message: 'Authentication Fails, Your api key: ****-key is invalid',
  }))
  let result: string
  try {
    result = await compactSession('a')
  } finally {
    server.restore()
  }

  assert.equal(result, 'auth', `401 该归成 auth，实际 ${result}`)
  // 失败不该动已有记录
  assert.equal(useChatStore.getState().sessionCache.a?.compaction, undefined)
})
