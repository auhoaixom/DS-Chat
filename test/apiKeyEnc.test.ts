import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSealedText } from '../src/services/crypto/seal.js'
import {
  resetApiKeyUnlockForTest,
  setApiKey,
  unlockApiKey,
  useSettings,
} from '../src/services/settings.js'

/**
 * API Key 的落盘与解锁。
 *
 * zustand 的初始值必须同步拿到，所以这把 Key 在启动瞬间是「没有」，
 * 由 unlockApiKey 在 boot 阶段补回明文。测试要守住的是：
 * 磁盘上是密文、内存里是明文、解不开时**宁可当作没填，也不把密文发出去**。
 */

const KEY = 'chat-demo:api-key'

const waitFor = async (check: () => boolean, label: string) => {
  for (let index = 0; index < 200; index += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

const setState = (apiKey: string | null) => useSettings.setState({ apiKey })

test('写入后磁盘上是密文，内存里是明文', async () => {
  setApiKey('sk-first-value')
  assert.equal(useSettings.getState().apiKey, 'sk-first-value')

  await waitFor(() => isSealedText(localStorage.getItem(KEY)), 'API Key 加密写盘')
  const sealed = localStorage.getItem(KEY) ?? ''
  assert.equal(sealed.includes('sk-first-value'), false)
})

test('冷启动：内存先空，解锁后补回明文', async () => {
  // 模拟新进程：内存清掉、解锁状态重置，磁盘上仍是上一条用例留下的密文
  setState(null)
  resetApiKeyUnlockForTest()

  await unlockApiKey()
  assert.equal(useSettings.getState().apiKey, 'sk-first-value')
})

test('明文旧值在解锁时被加密写回：升级即迁移', async () => {
  localStorage.setItem(KEY, 'sk-legacy-plain')
  setState(null)
  resetApiKeyUnlockForTest()

  await unlockApiKey()

  assert.equal(useSettings.getState().apiKey, 'sk-legacy-plain')
  const sealed = localStorage.getItem(KEY) ?? ''
  assert.ok(isSealedText(sealed))
  assert.equal(sealed.includes('sk-legacy-plain'), false)
})

test('解不开时内存置空：密文绝不能当明文交给请求', async () => {
  // 密钥换了、或记录坏了：这里用一个合法的 ds2: 前缀配一段过短的载荷
  localStorage.setItem(KEY, 'ds2:AAAA')
  setState(null)
  resetApiKeyUnlockForTest()

  await unlockApiKey()

  assert.equal(useSettings.getState().apiKey, null)
  // 原密文保留着，没有为了"看起来干净"把它删掉
  assert.equal(localStorage.getItem(KEY), 'ds2:AAAA')
})

test('清空 API Key 会把磁盘上的密文一起删掉', async () => {
  localStorage.setItem(KEY, 'ds2:AAAA')
  resetApiKeyUnlockForTest()
  setApiKey(null)

  await waitFor(() => localStorage.getItem(KEY) === null, 'API Key 被删除')
  assert.equal(useSettings.getState().apiKey, null)
})
