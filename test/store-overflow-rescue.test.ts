import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { isSummaryCall, messageCountOf, startScriptedFetch } from './scriptedFetch.js'

/**
 * 超限抢救（第一枪）：服务端说"prompt is too long"之后，
 * 客户端要自己压一次上下文、再把**带摘要**的请求重发一遍。
 *
 * 这是唯一绕过 0.8 阈值的压缩入口，也只有在用户真的撞墙之后才会跑到，
 * 算错覆盖段就是把人家的上下文压坏——而且没有任何阈值保护它。
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

const SUMMARY = '## 用户目标与背景\n把前面那些问题回答完'

const lastReply = () => {
  const messages = useChatStore.getState().sessionCache.a?.messages ?? []
  const last = messages[messages.length - 1]
  return last?.role === 'assistant' ? last : null
}

test('超限之后先压缩再重发，重发那一枪带的是摘要', async () => {
  await db.saveSession({
    id: 'a',
    title: '撞墙',
    createdAt: 1,
    updatedAt: 1,
    messages: longConversation(),
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch((call, index) => {
    if (isSummaryCall(call)) {
      return { kind: 'text', text: SUMMARY }
    }
    // 第一枪撞墙，压缩后的重发正常
    return index === 0 ? { kind: 'overflow' } : { kind: 'text', text: '接着答。' }
  })

  try {
    setDraftText('a', '接着聊')
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    server.restore()
  }

  // 三次请求：撞墙 → 摘要 → 重发。多一发少一发都是错
  assert.equal(server.chatCalls().length, 2, '聊天请求应当是"失败 + 重发"两发')
  assert.equal(server.summaryCalls().length, 1, '中间只该有一次摘要请求')

  const summary = server.summaryCalls()[0]
  assert.ok(summary)
  // 回放式摘要：被压缩那段原文原样发过去，末尾追加压缩指令
  assert.ok(messageCountOf(summary) >= 4, `摘要那一枪要带上被压掉的原文，实际 ${messageCountOf(summary)} 条`)

  const retried = server.chatCalls()[1]
  assert.ok(retried)
  assert.match(String(retried.body.system), /把前面那些问题回答完/, '重发那一枪的系统提示里要有摘要')
  assert.doesNotMatch(JSON.stringify(retried.body.messages), /问题 0：/, '被压掉的消息不该再进请求')

  const session = useChatStore.getState().sessionCache.a
  assert.ok(session?.compaction)
  assert.equal(session.compaction.mode, 'auto', '抢救压缩记的是 auto，不是用户点的 manual')
  assert.equal(session.compaction.viaReplay, true)
  assert.ok(session.compaction.coveredIds.length >= 2)

  assert.equal(lastReply()?.status, 'done', '重发成功之后回复应当正常落定，不该停在报错')
})
