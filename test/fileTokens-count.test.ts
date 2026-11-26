import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  IMAGE_TOKENS,
  calibrateImage,
  fileTokensOf,
  knownPrice,
  resetFileTokensForTest,
} from '../src/services/chat/fileTokens.js'
import type { FileAttachment } from '../src/services/chat/types.js'

/**
 * 图片定价走的是真的 `countTokens` → `request` → 全局 fetch 这条路，
 * 只把 fetch 换成假的：请求体、URL、响应解析都还是真的。
 */
const image: FileAttachment = {
  id: 'img-1',
  serverId: 'file-img-1',
  name: 'a.png',
  size: 53_970,
  isImage: true,
  mimeType: 'image/png',
}

const stub = (respond: () => Promise<Response>) => {
  const original = globalThis.fetch
  const seen: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    })
    return respond()
  }) as typeof fetch
  return {
    seen,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test('图片上传后问一次 count_tokens，拿到的就是真价', async () => {
  resetFileTokensForTest()
  const fake = stub(async () =>
    new Response(JSON.stringify({ input_tokens: 226 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  try {
    await calibrateImage('test-key', image, 'file-img-1', 'deepseek-flash')
    assert.equal(fileTokensOf(image), 226)
    const saved = await db.readMeta<{ tokens: number; source: string; model: string }>(
      'file-tokens:img-1'
    )
    assert.equal(saved?.tokens, 226)
    assert.equal(saved?.source, 'count')
    assert.equal(saved?.model, 'deepseek-flash')

    // 请求本身要对：走 count_tokens，带上 Files API 的 beta 头，体里是这张图的 file_id
    const call = fake.seen[0]
    assert.ok(call)
    assert.match(call.url, /\/anthropic\/v1\/messages\/count_tokens$/)
    assert.equal(call.headers['anthropic-beta'], 'files-api-2025-04-14')
    assert.deepEqual((call.body as { messages: unknown[] }).messages, [
      { role: 'user', content: [{ type: 'image', source: { type: 'file', file_id: 'file-img-1' } }] },
    ])
  } finally {
    fake.restore()
  }
})

test('数不出来时静默退回占位值，且不影响已经拿到的价格', async () => {
  resetFileTokensForTest()
  const failing = stub(async () => new Response('boom', { status: 500 }))
  try {
    await calibrateImage('test-key', image, 'file-img-1', 'deepseek-flash')
    assert.equal(fileTokensOf(image), IMAGE_TOKENS)
    assert.equal(knownPrice('img-1'), undefined)
  } finally {
    failing.restore()
  }
})

test('已经有价格的图片不再问第二次', async () => {
  resetFileTokensForTest()
  let calls = 0
  const counting = stub(async () => {
    calls += 1
    return new Response(JSON.stringify({ input_tokens: 300 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  try {
    await calibrateImage('test-key', image, 'file-img-1', 'deepseek-flash')
    await calibrateImage('test-key', image, 'file-img-1', 'deepseek-flash')
    assert.equal(calls, 1)
    assert.equal(fileTokensOf(image), 300)
  } finally {
    counting.restore()
  }
})
