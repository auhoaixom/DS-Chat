import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  continueReply,
  initChat,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { assistantMessage, userMessage } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 硬性规定：被压缩盖掉的回答不许"继续生成"。
 *
 * 这条只在**全覆盖**时才会碰到（继续生成永远作用在最后一条上，而最后一条
 * 一般都在保留段里）。全覆盖是真实存在的形态：导入的包、或者压过之后又没再说新话。
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

test('全覆盖时继续生成最后一条：什么都不发生，也不发请求', async () => {
  await db.saveSession({
    id: 'a',
    title: '续写不得',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'a-u1'),
      assistantMessage('第一答', 'a-a1'),
      userMessage('第二问', 'a-u2'),
      // 被服务端截断的回答才允许"继续生成"，所以这条得是 stopped
      { ...assistantMessage('第二答', 'a-a2'), status: 'stopped' as const },
    ],
    compaction: {
      summary: '整段都被压掉了',
      // 全部消息都在覆盖段里：界面上只剩一张卡片
      coveredIds: ['a-u1', 'a-a1', 'a-u2', 'a-a2'],
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
    continueReply('a', 'a-a2')
    const session = useChatStore.getState().sessionCache.a
    const last = session?.messages.at(-1)
    assert.equal(
      last?.role === 'assistant' ? last.status : null,
      'stopped',
      '被拒绝时不许把那条回答改成"待生成"'
    )
    assert.equal(session?.messages.length, 4, '也不许追加任何东西')
    assert.equal(server.calls.length, 0, '被拒绝时连请求都不该发')
    assert.equal(Object.hasOwn(useChatStore.getState().streaming, 'a'), false)
  } finally {
    server.restore()
  }
})
