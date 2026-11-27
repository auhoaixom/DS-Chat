import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import {
  initChat,
  selectSession,
  sendMessage,
  stopReply,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { isSummaryCall, startScriptedFetch } from './scriptedFetch.js'

/**
 * 抢救进行到一半用户点了停止：不许再重发。
 * 重发会在用户已经放弃之后又打一枪（还要花钱），而且压出来的记录会覆盖掉现在这份。
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

const lastReply = () => {
  const messages = useChatStore.getState().sessionCache.a?.messages ?? []
  const last = messages[messages.length - 1]
  return last?.role === 'assistant' ? last : null
}

test('抢救压缩进行中被停止：不重发、不留记录、回复标记为已停止', async () => {
  await db.saveSession({
    id: 'a',
    title: '中途喊停',
    createdAt: 1,
    updatedAt: 1,
    messages: longConversation(),
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch((call) =>
    isSummaryCall(call) ? { kind: 'hang' } : { kind: 'overflow' }
  )

  try {
    setDraftText('a', '接着聊')
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => server.hung.length === 1 && Object.hasOwn(useChatStore.getState().compacting, 'a'), '摘要请求已经在路上')
    assert.equal(server.chatCalls().length, 1, '前提：第一枪已经撞墙')
    stopReply('a')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    server.restore()
  }

  assert.equal(server.chatCalls().length, 1, '用户已经喊停，不许再重发')
  assert.equal(useChatStore.getState().sessionCache.a?.compaction, undefined, '压到一半的记录不许留下')
  assert.equal(Object.hasOwn(useChatStore.getState().compacting, 'a'), false, '压缩进度要收掉')
  assert.equal(lastReply()?.status, 'stopped')
})
