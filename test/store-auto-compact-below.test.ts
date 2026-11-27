import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateRequestTokens, requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { longConversation } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 阈值的另一半：还没到 0.8 就不许压。
 * 白压一次要花一次摘要的钱，用户的会话还会被凭空截断一段——
 * 这比"该压没压"更没道理，因为完全看不出原因。
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

test('没过 0.8 阈值：一次请求都不多打，也不留压缩记录', async () => {
  const messages = longConversation()
  const anchor = {
    id: 'a-anchor',
    role: 'assistant' as const,
    createdAt: 2,
    model: null,
    prefix: true,
    status: 'done' as const,
    blocks: [{ type: 'text' as const, text: '答' }],
    // 80 万 < 窗口 × 0.8（838860）：差一点点，但就是不该压
    usage: {
      input_tokens: 800_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 10,
    },
    promptEstimate: estimateRequestTokens(messages),
    estimateVersion: ESTIMATE_VERSION,
    requestKey: requestKeyOf({ model: useSettings.getState().model, hasFiles: false }),
  }
  await db.saveSession({
    id: 'a',
    title: '还没到',
    createdAt: 1,
    updatedAt: 1,
    messages: [...messages, anchor],
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch()

  try {
    setDraftText('a', '接着聊')
    sendMessage('a')
    await waitFor(() => useChatStore.getState().streaming.a !== undefined, '流已经开始')
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    server.restore()
  }

  assert.equal(server.calls.length, 1, `只该有一发聊天请求，实际 ${server.calls.length}`)
  assert.equal(useChatStore.getState().sessionCache.a?.compaction, undefined)
  assert.equal(useChatStore.getState().sessionCache.a?.extraCosts, undefined, '没压成就不该有额外花费')

  const last = useChatStore.getState().sessionCache.a?.messages.at(-1)
  assert.equal(last?.role === 'assistant' ? last.status : null, 'done', '正常发出去、正常回来')
})
