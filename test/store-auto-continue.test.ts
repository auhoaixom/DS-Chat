import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { setApiKey } from '../src/services/settings.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'

/**
 * 切网络把流掐断之后，**已经写出来的内容不能白扔**。
 *
 * 判据就两条：客户端会自己再发一次请求，而且第二次请求把前面那段当成助手前缀带上
 * （不是从头重发），拼起来正好是一段完整的回答。
 */
const encoder = new TextEncoder()
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const textStart = (text = '') =>
  frame('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text },
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

type Body = { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }

const session = () => useChatStore.getState().sessionCache.a

const replyOf = () => {
  const messages = session()?.messages ?? []
  const last = messages.filter((message) => message.role === 'assistant').at(-1)
  assert.ok(last && last.role === 'assistant', '没有找到回答')
  return last
}

const replyText = () =>
  replyOf()
    .blocks.map((block) => (block.type === 'text' ? block.text : ''))
    .join('')

test('切网络掐断流：自动接着写一次，已写内容不丢', async () => {
  await db.saveSession({
    id: 'a',
    title: '续写',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const original = globalThis.fetch
  const bodies: Body[] = []
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Body)
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

    streams[0]?.enqueue(encoder.encode(`${messageStart}${textStart()}${textDelta('从前有座山，')}`))
    await waitFor(() => replyText() === '从前有座山，', '第一段上屏')

    // 切网络：连接被掐，没有 message_stop 就断了
    streams[0]?.close()
    await waitFor(() => streams.length === 2, '应该自动发起第二次请求')

    const retry = bodies[1]
    assert.ok(retry, '没有第二次请求')
    const prefill = retry.messages.at(-1)
    assert.equal(prefill?.role, 'assistant', '第二次请求必须带助手前缀，不能从头重发')
    assert.equal(prefill?.content[0]?.text, '从前有座山，')

    streams[1]?.enqueue(
      encoder.encode(
        `${messageStart}${textStart()}${textDelta('山里有座庙。')}` +
          frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
          frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }) +
          frame('message_stop', { type: 'message_stop' })
      )
    )
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')

    assert.equal(replyText(), '从前有座山，山里有座庙。')
    assert.equal(replyOf().status, 'done')
    assert.equal(bodies.length, 2, '只该自动续写一次')
  } finally {
    globalThis.fetch = original
  }
})
