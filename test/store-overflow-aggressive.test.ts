import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { isSummaryCall, startScriptedFetch } from './scriptedFetch.js'

/**
 * 超限抢救（第二枪）：压过一轮还是超限，这一轮改成"抢救式"——
 * 只留最后一轮原文，把能削的头部全削掉。第三次仍然超限就按原始报错收尾，
 * 不能无限重试（每压一次都要花一次摘要的钱）。
 *
 * 抢救式压缩走的是**增量合并**：上一份摘要 + 新削掉的那段原文，
 * 不再重发早就摘要过的东西。这条路径平时根本跑不到，最容易写坏。
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

test('连续两次超限：第二次改成只留最后一轮，第三次直接报错收尾', async () => {
  const messages = longConversation()
  await db.saveSession({ id: 'a', title: '两次撞墙', createdAt: 1, updatedAt: 1, messages })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  let firstCovered = 0
  let secondCovered = 0
  let chats = 0
  const server = startScriptedFetch((call) => {
    if (isSummaryCall(call)) {
      return { kind: 'text', text: '## 用户目标与背景\n压缩后的摘要' }
    }
    chats += 1
    // 第二发聊天意味着第一轮抢救已经落定：这时记下它压掉多少（晚一步就会被第二轮覆盖）
    if (chats === 2) {
      firstCovered = useChatStore.getState().sessionCache.a?.compaction?.coveredIds.length ?? 0
    }
    return { kind: 'overflow' }
  })

  try {
    setDraftText('a', '接着聊')
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
    secondCovered = useChatStore.getState().sessionCache.a?.compaction?.coveredIds.length ?? 0
  } finally {
    server.restore()
  }

  // 三发聊天：撞墙 → 抢救后重发（又撞墙）→ 抢救后重发（还撞墙，收尾）
  assert.equal(server.chatCalls().length, 3, '最多抢救两次，第三次不许再重发')
  assert.ok(server.summaryCalls().length >= 2, `两次抢救各要一次摘要，实际 ${server.summaryCalls().length} 次`)

  // 抢救式压缩比第一轮狠：第一轮按 120K token 留原文，第二轮只留最后一轮（2 条）。
  // 此刻正在生成的那条回复也在可见消息里（它不是提问，切点会越过它），
  // 所以覆盖段可能整整是全部 100 条——那正是"能削的头部都削掉"。
  assert.ok(
    secondCovered >= messages.length - 2,
    `抢救式压缩只该留最后一轮，实际留下 ${messages.length - secondCovered} 条`
  )
  assert.ok(firstCovered > 0 && firstCovered < secondCovered, `第二轮要削得更多：${firstCovered} → ${secondCovered}`)
  assert.equal(useChatStore.getState().sessionCache.a?.compaction?.mode, 'auto')

  // 钱照记：两轮抢救的摘要请求都花了钱，不能因为最后失败就不入账
  const extra = useChatStore.getState().sessionCache.a?.extraCosts ?? []
  assert.ok(extra.length >= 2, `摘要请求的钱要入账，实际 ${extra.length} 笔`)

  // 用户看到的还是服务端原本那句超限，而不是"压不下来了"之类的内部措辞
  const reply = lastReply()
  assert.equal(reply?.status, 'error')
  assert.equal(reply?.error?.status, 400)
  assert.match(String(reply?.error?.message), /prompt is too long/)
})
