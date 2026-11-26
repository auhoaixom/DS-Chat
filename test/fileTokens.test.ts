import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  DOCUMENT_TOKENS,
  IMAGE_TOKENS,
  commitDerivedPrices,
  deriveDocumentPrices,
  fileTokensOf,
  hydrateFileTokens,
  knownPrice,
  resetFileTokensForTest,
} from '../src/services/chat/fileTokens.js'
import type { FileAttachment } from '../src/services/chat/types.js'

const file = (over: Partial<FileAttachment> = {}): FileAttachment => ({
  id: 'f1',
  serverId: 'file-1',
  name: 'a.txt',
  size: 100,
  isImage: false,
  mimeType: 'text/plain',
  ...over,
})

test('没有真值时退回占位值，有真值时用真值', () => {
  resetFileTokensForTest()
  assert.equal(fileTokensOf(file()), DOCUMENT_TOKENS)
  assert.equal(fileTokensOf(file({ id: 'f2', isImage: true })), IMAGE_TOKENS)

  const result = deriveDocumentPrices([{ file: file(), count: 1 }], 2_900, 2_600)
  assert.ok(result)
  assert.equal(result.applied[0]?.tokens, 2_300)
  assert.equal(result.delta, 300, '占位 2000 → 2300，口径差 +300')
})

test('反推出来的价格写进 meta，重启后能水合回来', async () => {
  resetFileTokensForTest()
  const result = deriveDocumentPrices([{ file: file(), count: 1 }], 2_900, 2_600)
  assert.ok(result)
  await commitDerivedPrices(result, 'deepseek-flash')

  assert.equal(fileTokensOf(file()), 2_300)
  const saved = await db.readMeta<{ tokens: number; source: string }>('file-tokens:f1')
  assert.equal(saved?.tokens, 2_300)
  assert.equal(saved?.source, 'derived')

  // 模拟重启：内存清空后从库里读回来
  resetFileTokensForTest()
  assert.equal(knownPrice('f1'), undefined)
  await hydrateFileTokens()
  assert.equal(fileTokensOf(file()), 2_300)
})

test('两个文档按字节数分摊，合计等于反推出来的总价', () => {
  resetFileTokensForTest()
  const small = file({ id: 'small', size: 1_000 })
  const big = file({ id: 'big', size: 9_000 })
  // estimate 里含两个 2000 的占位，measured 比它多 6000 → 这批文档真实共 10000
  const result = deriveDocumentPrices(
    [
      { file: small, count: 1 },
      { file: big, count: 1 },
    ],
    11_000,
    5_000
  )
  assert.ok(result)
  const tokens = new Map(result.applied.map((item) => [item.fileId, item.tokens]))
  assert.equal(tokens.get('small'), 1_000)
  assert.equal(tokens.get('big'), 9_000)
  assert.equal(result.delta, 6_000, '2000+2000 的占位换成 10000')
})

test('同一份文档在一次请求里出现两次时，单价按两份摊', () => {
  resetFileTokensForTest()
  // 占位里这份文档算了两次（4000），实测比估算多 3000 → 真实总价 7000，单价 3500
  const result = deriveDocumentPrices([{ file: file({ size: 500 }), count: 2 }], 12_000, 9_000)
  assert.ok(result)
  assert.equal(result.applied[0]?.tokens, 3_500)
  assert.equal(result.delta, 3_000)
})

test('服务端用量不可信时不反推', () => {
  resetFileTokensForTest()
  assert.equal(deriveDocumentPrices([{ file: file(), count: 1 }], 20, 2_600), null)
})

test('反推出负数或大得离谱时不写，继续用占位值', () => {
  resetFileTokensForTest()
  // 其余部分估高太多 → 反推成负数
  assert.equal(deriveDocumentPrices([{ file: file(), count: 1 }], 100, 5_000), null)
  // 一个请求几百 K：一定是估算或服务端出了问题
  assert.equal(deriveDocumentPrices([{ file: file(), count: 1 }], 300_000, 0), null)
  assert.equal(fileTokensOf(file()), DOCUMENT_TOKENS)
})

test('已经有价格的文档不会被再次反推', async () => {
  resetFileTokensForTest()
  const first = deriveDocumentPrices([{ file: file(), count: 1 }], 2_900, 2_600)
  assert.ok(first)
  await commitDerivedPrices(first, 'deepseek-flash')
  const again = deriveDocumentPrices([{ file: file(), count: 1 }], 9_000, 1_000)
  assert.equal(again, null)
})
