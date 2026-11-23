import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromBase64, toBase64 } from '../src/services/crypto/base64.js'
import {
  isSealedText,
  openBytes,
  openText,
  sealBytes,
  sealText,
} from '../src/services/crypto/seal.js'

/**
 * 加解密原语。这一层只知道字节，所以测试也只看字节：
 * 将来给附件加密时走的是同一对函数，这里覆盖到的行为就是附件那边会拿到的行为。
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const bytesOf = async (value: Uint8Array | Promise<Uint8Array>) => new Uint8Array(await value)

test('base64 往返：各种长度都不丢字节，也没有多出来的尾巴', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255]) {
    const bytes = new Uint8Array(length).map((_value, index) => (index * 37) & 0xff)
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes, `length=${length}`)
  }
})

test('字节往返：空串、中文、二进制大块加解密后逐字节一致', async () => {
  const cases = [
    new Uint8Array(0),
    encoder.encode('hello'),
    encoder.encode('中文、emoji 🎉 与换行\n第二行'),
    new Uint8Array(1024 * 1024).fill(7),
  ]
  for (const plain of cases) {
    const sealed = await sealBytes(plain)
    assert.deepEqual(await bytesOf(openBytes(sealed)), plain)
  }
})

test('载荷首字节是格式版本；未知版本直接报错，不做猜测', async () => {
  const sealed = new Uint8Array(await sealBytes(encoder.encode('x')))
  assert.equal(sealed[0], 2)
  sealed[0] = 9
  await assert.rejects(() => openBytes(sealed), /unsupported sealed payload version: 9/)
})

test('附加数据不匹配就解不开：把 A 的密文当 B 的用会失败', async () => {
  const sealed = await sealBytes(encoder.encode('secret'), 'a#body')
  assert.equal(decoder.decode(await bytesOf(openBytes(sealed, 'a#body'))), 'secret')
  await assert.rejects(() => openBytes(sealed, 'b#body'))
  await assert.rejects(() => openBytes(sealed))
})

test('密文被改动或被截断都解不开', async () => {
  const sealed = await sealBytes(encoder.encode('secret'), 'x#body')
  const tampered = new Uint8Array(sealed)
  tampered[tampered.length - 1] ^= 0xff
  await assert.rejects(() => openBytes(tampered, 'x#body'))
  await assert.rejects(() => openBytes(sealed.slice(0, 20), 'x#body'))
})

test('两次加密同一段明文得到不同密文：nonce 每次都是新的', async () => {
  const plain = encoder.encode('same plaintext')
  const first = new Uint8Array(await sealBytes(plain))
  const second = new Uint8Array(await sealBytes(plain))
  assert.notDeepEqual(first, second)
})

test('字符串形态带 ds2: 前缀；不是密文的一律读回 null', async () => {
  const sealed = await sealText('sk-test-value', 'chat-demo:api-key')
  assert.ok(sealed.startsWith('ds2:'))
  assert.equal(isSealedText(sealed), true)
  assert.equal(await openText(sealed, 'chat-demo:api-key'), 'sk-test-value')

  // 明文当密文读回来必须是 null，不能原样返回：那等于给「把密文换成明文」留了通道
  assert.equal(await openText('sk-test-value'), null)
  assert.equal(isSealedText('sk-test-value'), false)
  assert.equal(isSealedText(null), false)
})
