import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { estimateRequestTokens } from '../src/services/chat/compaction.js'
import { resetFileTokensForTest } from '../src/services/chat/fileTokens.js'
import { SYSTEM_PROMPT } from '../src/services/chat/prompt.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { estimateMessageTokens, estimateTokens } from '../src/services/chat/tokens.js'
import type { AssistantMessage, Session, UserMessage } from '../src/services/chat/types.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 文档附件定价的端到端：真发一次、服务端回报 usage、我们反推出单价并记住。
 *
 * 用假流（`test/fakeStream.ts` 的思路）灌一份带 usage 的 message_delta：
 * URL 拼接、请求头、SSE 解析、事件派发、写库全都是真实代码。
 */
const encoder = new TextEncoder()
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

const session = (): Session | undefined => useChatStore.getState().sessionCache.a

const replies = () =>
  (session()?.messages ?? []).filter((message): message is AssistantMessage => message.role === 'assistant')

const question = (): UserMessage => {
  const first = session()?.messages[0]
  assert.ok(first && first.role === 'user', '第一条应当是提问')
  return first
}

test('带文档发一次：反推单价、修正这条回复的估算，之后一直用真价', async () => {
  resetFileTokensForTest()
  const document: UserMessage = {
    id: 'a-m1',
    role: 'user',
    content: '看看这份文档',
    files: [
      {
        id: 'doc-1',
        serverId: 'file-1',
        name: 'a.txt',
        size: 1_696,
        isImage: false,
        mimeType: 'text/plain',
      },
    ],
    createdAt: 1,
  }
  await db.saveSession({
    id: 'a',
    title: '文档定价',
    createdAt: 1,
    updatedAt: 1,
    messages: [document],
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  // 发请求前我们按占位值算的那份估算，与 store 的算法同一套：
  // 历史（带文档）+ 这一轮的提问 + 系统提示词
  const draft = '请总结它'
  const estimate =
    estimateRequestTokens([document, userMessage(draft)]) + estimateTokens(SYSTEM_PROMPT)
  const measured = 599 // 真机实测：1 696 B 的 txt，count_tokens 只给 44，真发是 599

  const original = globalThis.fetch
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller)
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch

  try {
    setDraftText('a', draft)
    sendMessage('a')
    await waitFor(() => controllers.length === 1, '流已建立')

    controllers[0]?.enqueue(
      encoder.encode(
        frame('message_start', {
          type: 'message_start',
          message: { id: 'msg', role: 'assistant', usage: { input_tokens: 0, output_tokens: 0 } },
        }) +
          frame('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }) +
          frame('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '好的。' },
          }) +
          frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
          frame('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: {
              input_tokens: measured,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 12,
            },
          }) +
          frame('message_stop', { type: 'message_stop' })
      )
    )
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')

    // 反推：measured − estimate + 占位 2000
    const expected = measured - estimate + 2_000
    const saved = await db.readMeta<{ tokens: number; source: string }>('file-tokens:doc-1')
    assert.equal(saved?.source, 'derived')
    assert.equal(saved?.tokens, expected)

    // 这条回复的 promptEstimate 被修正到实测值：下次测算不会把校准当成"对话变长"
    const reply = replies().at(-1)
    assert.ok(reply)
    assert.equal(reply.promptEstimate, measured)

    // 之后估价就用真值，不再用 2000
    assert.equal(estimateMessageTokens(question()), estimateMessageTokens({ ...document, files: [] }) + expected)
  } finally {
    globalThis.fetch = original
  }
})
