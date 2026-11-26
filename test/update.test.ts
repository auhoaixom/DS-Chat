import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  checkForUpdate,
  compareVersions,
  LATEST_API,
  parseRelease,
} from '../src/services/update.js'

/** 假响应：只要 ok / status / text 三样，checkForUpdate 也只读这三样 */
const respond =
  (status: number, body: string) =>
  async (): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })

const release = (tag: string, apk: string | null = 'DS-Chat.apk') => ({
  tag_name: tag,
  assets: apk ? [{ name: apk, browser_download_url: 'https://example.test/ds-chat.apk' }] : [],
})

const okBody = (tag: string, apk: string | null = 'DS-Chat.apk') =>
  respond(200, JSON.stringify(release(tag, apk)))

test('比版本号：新的更大，旧的更小，一样就是一样', () => {
  assert.equal(compareVersions('1.6.0', '1.5.0'), 1)
  assert.equal(compareVersions('1.5.0', '1.6.0'), -1)
  assert.equal(compareVersions('1.5.0', '1.5.0'), 0)
})

test('比版本号：逐段按数字比，不是按字符串比', () => {
  // 字符串比较会把 "1.9.9" 判成比 "1.10.0" 大，这里必须按数字
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.9.9', '1.10.0'), -1)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
})

test('比版本号：v 前缀与预发布标记都不影响结果', () => {
  assert.equal(compareVersions('v1.6.0', '1.5.0'), 1)
  assert.equal(compareVersions('V1.6.0', 'v1.5.0'), 1)
  assert.equal(compareVersions('1.6.0-beta.1', '1.6.0'), 0)
})

test('比版本号：段数不同按补零算', () => {
  assert.equal(compareVersions('1.5', '1.5.0'), 0)
  assert.equal(compareVersions('1.5', '1.5.1'), -1)
})

test('比版本号：解析不出来时当成没有更新，绝不编一个更高的版本', () => {
  assert.equal(compareVersions('', '1.6.0'), 0)
  assert.equal(compareVersions('latest', '1.6.0'), 0)
  assert.equal(compareVersions('1.6.0', 'beta'), 0)
  assert.equal(compareVersions('1.6.x', '1.5.0'), 0)
})

test('解析 Release：取 tag_name 与 apk 直链', () => {
  assert.deepEqual(parseRelease(release('v1.6.0')), {
    version: 'v1.6.0',
    downloadUrl: 'https://example.test/ds-chat.apk',
  })
})

test('解析 Release：没有挂 apk 时直链是 null，让界面退回发布页', () => {
  assert.deepEqual(parseRelease(release('v1.6.0', null)), { version: 'v1.6.0', downloadUrl: null })
  assert.deepEqual(parseRelease({ tag_name: 'v1.6.0' }), { version: 'v1.6.0', downloadUrl: null })
})

test('解析 Release：在多个附件里挑 apk，不被校验文件抢走', () => {
  const body = {
    tag_name: 'v1.6.0',
    assets: [
      { name: 'DS-Chat-v1.6.0.apk.sha256', browser_download_url: 'https://example.test/sum' },
      { name: 'DS-Chat-v1.6.0.apk', browser_download_url: 'https://example.test/apk' },
    ],
  }
  assert.equal(parseRelease(body)?.downloadUrl, 'https://example.test/apk')
})

test('解析 Release：没有 tag_name 就当没解析出来', () => {
  assert.equal(parseRelease({}), null)
  assert.equal(parseRelease({ tag_name: '' }), null)
  assert.equal(parseRelease({ tag_name: 16 }), null)
  assert.equal(parseRelease(null), null)
  assert.equal(parseRelease('nope'), null)
})

test('检查更新：远端更高 → 可以更新，并带上直链', async () => {
  const outcome = await checkForUpdate('1.5.0', { fetchImpl: okBody('v1.6.0') })
  assert.deepEqual(outcome, {
    kind: 'available',
    version: 'v1.6.0',
    downloadUrl: 'https://example.test/ds-chat.apk',
  })
})

test('检查更新：版本相同 → 已是最新', async () => {
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: okBody('v1.6.0') }), {
    kind: 'latest',
  })
})

test('检查更新：远端更低（装的是更新的测试包）→ 也说自己是最新', async () => {
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: okBody('v1.5.0') }), {
    kind: 'latest',
  })
})

test('检查更新：403/429 是限流，不是坏掉了', async () => {
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: respond(403, '') }), {
    kind: 'failed',
    reason: 'rate',
  })
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: respond(429, '') }), {
    kind: 'failed',
    reason: 'rate',
  })
})

test('检查更新：其它非 200 与坏 JSON 都算返回不对', async () => {
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: respond(500, '') }), {
    kind: 'failed',
    reason: 'bad',
  })
  assert.deepEqual(await checkForUpdate('1.6.0', { fetchImpl: respond(200, '<html>') }), {
    kind: 'failed',
    reason: 'bad',
  })
  assert.deepEqual(
    await checkForUpdate('1.6.0', { fetchImpl: respond(200, JSON.stringify({ message: 'Not Found' })) }),
    { kind: 'failed', reason: 'bad' }
  )
})

test('检查更新：请求打的是那个公开接口，且带 Accept', async () => {
  let seenUrl = ''
  let seenAccept = ''
  await checkForUpdate('1.6.0', {
    fetchImpl: async (url, init) => {
      seenUrl = url
      seenAccept = (init?.headers as Record<string, string>)?.Accept ?? ''
      return { ok: true, status: 200, text: async () => JSON.stringify(release('v1.6.0')) }
    },
  })
  assert.equal(seenUrl, LATEST_API)
  assert.match(seenAccept, /github/)
})

test('检查更新：网络断了说的是 network', async () => {
  const outcome = await checkForUpdate('1.6.0', {
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  assert.deepEqual(outcome, { kind: 'failed', reason: 'network' })
})

test('检查更新：超时不会一直等下去', async () => {
  const hanging = (_url: string, init?: RequestInit) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError'))
      )
    })
  const outcome = await checkForUpdate('1.6.0', { fetchImpl: hanging, timeoutMs: 5 })
  assert.deepEqual(outcome, { kind: 'failed', reason: 'network' })
})

test('检查更新：外部已经取消时，连请求都不发', async () => {
  let called = false
  const controller = new AbortController()
  controller.abort()
  const outcome = await checkForUpdate('1.6.0', {
    fetchImpl: async () => {
      called = true
      return { ok: true, status: 200, text: async () => '{}' }
    },
    signal: controller.signal,
  })
  assert.equal(called, false)
  assert.deepEqual(outcome, { kind: 'failed', reason: 'network' })
})
