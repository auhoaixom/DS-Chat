import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateRequestTokens, requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { isSummaryCall, startScriptedFetch } from './scriptedFetch.js'

/**
 * 阈值自动压缩（`needsCompaction`）的端到端：用户不点任何按钮，
 * 发送前自己发现"这轮要超了"，先压再发。
 *
 * 以前这条只有单测间接碰过（每次真机验证都是手动点的）。它的风险是两头：
 * 该压没压 → 撞墙；不该压却压了 → 白花一次摘要的钱，用户还莫名其妙看到卡片。
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

const SUMMARY = '## 用户目标与背景\n这条会话一直在一问一答'

/**
 * 会话 + 一条"服务端说占用了 usage 个 token"的回复。
 *
 * 之所以不真造一份 84 万 token 的对话：`needsCompaction` 用的是**面板那个数**
 * （锚点实测 + 表面净增减），锚点说多少就是多少。这样既测的同一段代码，
 * 又不用在测试里塞 2MB 字符串（§2 的价值在"先压后发"这个顺序，不在估算函数）。
 */
const seeded = (usage: number) => {
  const messages = longConversation()
  const promptEstimate = estimateRequestTokens(messages)
  const anchor = {
    id: 'a-anchor',
    role: 'assistant' as const,
    createdAt: 2,
    model: null,
    prefix: true,
    status: 'done' as const,
    blocks: [{ type: 'text' as const, text: '答' }],
    usage: {
      input_tokens: usage,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 10,
    },
    promptEstimate,
    estimateVersion: ESTIMATE_VERSION,
    requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: false }),
  }
  return { id: 'a', title: '阈值', createdAt: 1, updatedAt: 1, messages: [...messages, anchor] }
}

test('过了 0.8 阈值：发送前自己先压一次，再带着摘要发出去', async () => {
  await db.saveSession(seeded(900_000))
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch((call) =>
    isSummaryCall(call) ? { kind: 'text', text: SUMMARY } : { kind: 'text', text: '接着答。' }
  )

  try {
    setDraftText('a', '接着聊')
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    server.restore()
  }

  assert.equal(server.calls.length, 2, `先压后发正好两发，实际 ${server.calls.length}`)
  assert.equal(server.summaryCalls().length, 1, '第一发必须是摘要')
  assert.equal(server.chatCalls().length, 1, '第二发才是聊天')

  const chat = server.chatCalls()[0]
  assert.ok(chat)
  assert.match(String(chat.body.system), /这条会话一直在一问一答/, '聊天请求里要带摘要')
  assert.doesNotMatch(JSON.stringify(chat.body.messages), /问题 0：/, '被压掉的消息不该再进请求')

  const session = useChatStore.getState().sessionCache.a
  assert.ok(session?.compaction, '压缩记录要写进会话（卡片要显示它）')
  assert.equal(session.compaction.mode, 'auto', '自动压缩不是 manual')
  // 摘要那笔钱算在会话合计里，不挂在某条回复头上
  assert.ok((session.extraCosts ?? []).length >= 1)

  const last = session.messages[session.messages.length - 1]
  assert.equal(last?.role === 'assistant' ? last.status : null, 'done')
})
