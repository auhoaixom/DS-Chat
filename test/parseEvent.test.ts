import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMessageEvent } from '../src/services/api/parseEvent.js'

const usage = {
  input_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 20,
  output_tokens: 3,
}

test('非对象与未知事件一律丢弃，不影响后续内容', () => {
  assert.equal(readMessageEvent(null), null)
  assert.equal(readMessageEvent('message_start'), null)
  assert.equal(readMessageEvent([]), null)
  assert.equal(readMessageEvent({ type: 'ping' }), null)
  assert.equal(readMessageEvent({}), null)
})

test('message_start 保留用量；用量字段不全时置空但事件仍然可用', () => {
  const ok = readMessageEvent({
    type: 'message_start',
    message: { id: 'msg_1', model: 'deepseek-v4.1-flash', usage },
  })
  assert.equal(ok?.type, 'message_start')
  assert.deepEqual(
    (ok as { message: { usage: unknown } }).message.usage,
    usage,
    '完整用量应原样保留'
  )

  // 少一个字段就当作没有用量：不能拿半截数字去算上下文占用
  const partial = readMessageEvent({
    type: 'message_start',
    message: { usage: { input_tokens: 10, cache_read_input_tokens: 20 } },
  })
  assert.equal(partial?.type, 'message_start')
  assert.equal((partial as { message: { usage: unknown } }).message.usage, undefined)

  assert.equal(readMessageEvent({ type: 'message_start', message: 'nope' }), null)
})

test('文本块起始：缺 text 或下标非法都丢弃', () => {
  assert.deepEqual(
    readMessageEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'hi' } }),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'hi' } }
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
    null
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_start', index: -1, content_block: { type: 'text', text: 'x' } }),
    null
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_start', index: 1.5, content_block: { type: 'text', text: 'x' } }),
    null
  )
})

test('引用只保留结构完整的那几条', () => {
  const event = readMessageEvent({
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: '正文',
      citations: [
        { type: 'web_search_result_location', url: 'https://a', title: 'A' },
        { type: 'web_search_result_location', title: '缺 url' },
        { type: 'other', url: 'https://b' },
        { type: 'web_search_result_location', url: 'https://c', title: null },
      ],
    },
  })
  const citations = (event as { content_block: { citations: { url: string }[] } }).content_block
    .citations
  assert.deepEqual(
    citations.map((citation) => citation.url),
    ['https://a', 'https://c']
  )
})

test('思考块与增量：签名缺失不算错误，内容缺失才丢弃', () => {
  const start = readMessageEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: '' },
  })
  assert.equal(start?.type, 'content_block_start')

  assert.deepEqual(
    readMessageEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }),
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta' } }),
    null
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta' } }),
    null
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta' } }),
    null
  )
})

test('引用增量必须带合法的 citation', () => {
  const ok = readMessageEvent({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'citations_delta',
      citation: { type: 'web_search_result_location', url: 'https://a', title: null },
    },
  })
  assert.equal(ok?.type, 'content_block_delta')
  assert.equal(
    readMessageEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'citations_delta', citation: { type: 'web_search_result_location' } },
    }),
    null
  )
  assert.equal(
    readMessageEvent({ type: 'content_block_delta', index: 0, delta: { type: 'unknown_delta' } }),
    null
  )
})

test('块结束只认合法下标', () => {
  assert.equal(readMessageEvent({ type: 'content_block_stop', index: 0 })?.type, 'content_block_stop')
  assert.equal(readMessageEvent({ type: 'content_block_stop', index: -2 }), null)
  assert.equal(readMessageEvent({ type: 'content_block_stop' }), null)
})

test('结束原因必须在白名单里，否则整条丢弃', () => {
  const ok = readMessageEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { ...usage, output_tokens: 99 },
  })
  assert.equal(ok?.type, 'message_delta')

  assert.equal(
    readMessageEvent({ type: 'message_delta', delta: { stop_reason: 'weird_reason' } }),
    null
  )
  assert.equal(readMessageEvent({ type: 'message_delta', delta: {} }), null)
  assert.equal(readMessageEvent({ type: 'message_delta' }), null)

  // 用量不完整时置空，但结束原因仍然要送达，否则界面会一直以为还在生成
  const brokenUsage = readMessageEvent({
    type: 'message_delta',
    delta: { stop_reason: 'max_tokens' },
    usage: { input_tokens: 1 },
  })
  assert.equal(brokenUsage?.type, 'message_delta')
  assert.equal((brokenUsage as { usage: unknown }).usage, undefined)
})

test('message_stop 原样通过', () => {
  assert.deepEqual(readMessageEvent({ type: 'message_stop' }), { type: 'message_stop' })
})

test('服务端工具块：字段不全就丢弃，客户端工具块则放行交给上层处理', () => {
  const searchCall = {
    type: 'server_tool_use',
    id: 'tool_1',
    name: 'deepseek_web_search',
    kind: 'search',
    input: { action: 'search', queries: ['q'] },
  }
  assert.equal(
    readMessageEvent({ type: 'content_block_start', index: 0, content_block: searchCall })?.type,
    'content_block_start'
  )

  const badQueries = { ...searchCall, input: { action: 'search', queries: [1] } }
  assert.equal(
    readMessageEvent({ type: 'content_block_start', index: 0, content_block: badQueries }),
    null
  )

  // 客户端工具：不展示内容，但要放行，让上层关掉这条回答的续写
  assert.equal(
    readMessageEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 't', name: 'x', input: {} },
    })?.type,
    'content_block_start'
  )
})
