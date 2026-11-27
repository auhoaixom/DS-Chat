import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateRequestTokens, requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { conversation } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 阈值到了、但**没有可压的东西**：`planCompaction` 返回 null（消息太少）。
 * 这正是"复现B"那个形态——面板显示占用很高，压缩按钮点下去却说没东西可压。
 *
 * 此时发送必须照常进行：不许拦下请求、不许报错、也不许挂一条空摘要。
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

test('超过阈值但无可压内容：照常发送，不压也不报错', async () => {
  const messages = conversation(2)
  const anchor = {
    id: 'a-anchor',
    role: 'assistant' as const,
    createdAt: 2,
    model: null,
    prefix: true,
    status: 'done' as const,
    blocks: [{ type: 'text' as const, text: '答' }],
    usage: {
      input_tokens: 900_000,
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
    title: '没东西可压',
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
  const session = useChatStore.getState().sessionCache.a
  assert.equal(session?.compaction, undefined)
  assert.equal(session?.extraCosts, undefined)

  const last = session?.messages.at(-1)
  assert.equal(last?.role === 'assistant' ? last.status : null, 'done')
  assert.equal(last?.role === 'assistant' ? last.error : null, undefined, '不该报错')
})
