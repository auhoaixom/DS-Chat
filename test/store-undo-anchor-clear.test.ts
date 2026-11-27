import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 撤销时挂上的锚点只是临时的：新的回复带回实测之后就该交还给"最近一条"，
 * 否则它会一直把面板钉在压缩前那个数上。
 *
 * 注意：必须真的喂一份带 usage 的 `message_delta`——`fakeStream.begin()` 只发
 * message_start 和文本增量，不带 message_delta，用它的话这条测试会"假通过"
 * （锚点之所以消失，是因为当时它根本没被写进库，而不是被交还）。
 */
const encoder = new TextEncoder()
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

test('新的实测到了之后，撤销时挂上的锚点自动交还', async () => {
  await db.saveSession({
    id: 'a',
    title: '交还',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('问', 'a-m1')],
    // 模拟"撤销压缩后挂着一个指回旧回复的锚点"
    anchorId: '一条不存在的旧回复',
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')
  assert.equal(useChatStore.getState().sessionCache.a?.anchorId, '一条不存在的旧回复', '前提：锚点读回来了')

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
    setDraftText('a', '再问一句')
    sendMessage('a')
    await waitFor(() => controllers.length === 1, '流已开始')

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
              input_tokens: 120,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 5,
            },
          }) +
          frame('message_stop', { type: 'message_stop' })
      )
    )
    await waitFor(
      () => useChatStore.getState().sessionCache.a?.anchorId === undefined,
      '锚点被交还'
    )
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '流结束')
  } finally {
    globalThis.fetch = original
  }

  const after = useChatStore.getState().sessionCache.a
  assert.ok(after)
  // 交还之后按"最近一条带实测的回复"算，不会崩
  const usage = getContextUsage(after)
  assert.ok(usage)
  assert.notEqual(usage.anchorId, undefined)

  // 而且交还要落盘：重开之后不该又冒出那个旧锚点（写盘是异步的，等它落地）
  let stored = await db.loadSession('a')
  for (let i = 0; i < 100 && stored?.anchorId !== undefined; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    stored = await db.loadSession('a')
  }
  assert.equal(stored?.anchorId, undefined)
})
