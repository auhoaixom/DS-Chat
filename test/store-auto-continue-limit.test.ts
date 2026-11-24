import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { setApiKey } from '../src/services/settings.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

/**
 * 自动续写**只做一次**：第二次还断就照常报错。
 *
 * 这条守的是钱 —— 网络一直不通时反复自动重发，等于拿用户的额度试运气。
 */
const encoder = new TextEncoder()
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const textStart = frame('content_block_start', {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
})

const textDelta = (text: string) =>
  frame('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })

const messageStart = frame('message_start', {
  type: 'message_start',
  message: { id: 'msg', role: 'assistant' },
})

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

test('第二次还是断流就报错，不再自动重试', async () => {
  await db.saveSession({
    id: 'a',
    title: '反复断网',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const original = globalThis.fetch
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streams.push(controller)
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch

  try {
    setDraftText('a', '讲个长故事')
    sendMessage('a')
    await waitFor(() => streams.length === 1, '第一路流已建立')

    streams[0]?.enqueue(encoder.encode(`${messageStart}${textStart}${textDelta('第一段')}`))
    // 让第一段真的进到回复里再断，这样第二次请求带的是"续写"而不是"重发"
    await new Promise((resolve) => setTimeout(resolve, 50))
    streams[0]?.close()

    await waitFor(() => streams.length === 2, '第一次断流后应该自动续写')
    streams[1]?.enqueue(encoder.encode(`${messageStart}${textStart}${textDelta('第二段')}`))
    streams[1]?.close()

    await waitFor(() => useChatStore.getState().streaming.a === undefined, '最终收尾')

    assert.equal(streams.length, 2, '只该自动续写一次，不能无限重试')
    const last = (useChatStore.getState().sessionCache.a?.messages ?? [])
      .filter((message) => message.role === 'assistant')
      .at(-1)
    assert.ok(last && last.role === 'assistant')
    assert.equal(last.status, 'error', '第二次断流要照常报错')
    assert.ok(last.error, '错误信息要留着，用户可以点重新生成')
  } finally {
    globalThis.fetch = original
  }
})
