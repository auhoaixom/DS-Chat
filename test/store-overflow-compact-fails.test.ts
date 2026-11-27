import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { isSummaryCall, startScriptedFetch } from './scriptedFetch.js'

/**
 * 抢救压缩本身失败时（摘要请求 500、网络断）要"原地不动"：
 * 不留半成品记录、不把钱记成花了、也不把内部错误顶替掉服务端原本那句超限。
 * 用户该看到的是「上下文太长」，不是「摘要请求失败」。
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

test('抢救压缩自己失败：不留半成品、不记钱、用户看到原报错', async () => {
  await db.saveSession({
    id: 'a',
    title: '摘要也挂了',
    createdAt: 1,
    updatedAt: 1,
    messages: longConversation(),
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch((call) =>
    isSummaryCall(call)
      ? { kind: 'error', status: 500, message: 'upstream exploded' }
      : { kind: 'overflow' }
  )

  try {
    setDraftText('a', '接着聊')
    // 不 catch：抢救失败不该把异常抛给调用方（那会变成"界面出错了"兜底页）
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    server.restore()
  }

  assert.equal(server.chatCalls().length, 3, '两次抢救各失败一次，第三次按原报错收尾')
  assert.equal(server.summaryCalls().length, 2, '两次抢救各试过一次摘要')

  const session = useChatStore.getState().sessionCache.a
  assert.equal(session?.compaction, undefined, '失败的压缩不许留下记录，否则界面会挂着一条空的摘要卡片')
  assert.equal(session?.extraCosts, undefined, '摘要请求根本没成功，不该记成花了钱')
  assert.equal(Object.hasOwn(useChatStore.getState().compacting, 'a'), false, '压缩进度要收掉')

  const reply = lastReply()
  assert.equal(reply?.status, 'error')
  assert.equal(reply?.error?.status, 400)
  assert.match(
    String(reply?.error?.message),
    /prompt is too long/,
    '用户看到的是服务端原本那句超限，不是摘要请求的 500'
  )

  // 半成品也不能落盘：重开之后依然没有压缩记录
  const stored = await db.loadSession('a')
  assert.equal(stored?.compaction, undefined)
})
