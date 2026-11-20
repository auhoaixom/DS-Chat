import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  estimateMessageTokens,
  estimateTokens,
  formatTokens,
  getContextWindow,
  getPromptTokens,
} from '../src/services/chat/tokens.js'
import { assistantMessage, documentFile, imageFile, userMessage } from './helpers.js'

test('中文按字数折算、ASCII 按约 3.3 字符折算，并且向上取整', () => {
  assert.equal(estimateTokens(''), 0)
  // 2 个汉字 → ceil(1.5)
  assert.equal(estimateTokens('你好'), 2)
  // 5 个 ASCII → ceil(1.6)
  assert.equal(estimateTokens('hello'), 2)
  // 中英混排 → ceil(0.75 + 0.32)
  assert.equal(estimateTokens('中a'), 2)
})

test('估算是偏大的：同样的字数，估算不低于按经验折算的下限', () => {
  const text = 'a'.repeat(1_000)
  assert.ok(estimateTokens(text) >= 300)
  assert.ok(estimateTokens(text) <= 330)
})

test('用户消息带固定的 8 token 开销，附件按类别折算', () => {
  assert.equal(estimateMessageTokens(userMessage('hello')), 2 + 8)

  const withImage = { ...userMessage(''), files: [imageFile()] }
  assert.equal(estimateMessageTokens(withImage), 1_500 + 8)

  const withDocument = { ...userMessage(''), files: [documentFile()] }
  assert.equal(estimateMessageTokens(withDocument), 2_000 + 8)

  const withBoth = { ...userMessage(''), files: [imageFile(), documentFile()] }
  assert.equal(estimateMessageTokens(withBoth), 1_500 + 2_000 + 8)
})

test('助手消息只累计文本块', () => {
  assert.equal(estimateMessageTokens(assistantMessage('hello')), 8 + 2)
})

test('提示侧用量把缓存写入与缓存命中都算进来', () => {
  assert.equal(getPromptTokens(undefined), 0)
  assert.equal(
    getPromptTokens({
      input_tokens: 10,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 20,
      output_tokens: 999,
    }),
    60
  )
})

test('token 数的紧凑显示', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_000), '1.0K')
  assert.equal(formatTokens(1_500), '1.5K')
  assert.equal(formatTokens(12_000), '12K')
  assert.equal(formatTokens(1_048_576), '1.0M')
})

test('窗口以模型声明为准，认不出的模型退回 1Mi', () => {
  assert.equal(getContextWindow('deepseek-flash'), 1_048_576)
  assert.equal(getContextWindow('deepseek-v4.1-flash'), 1_048_576)
  assert.equal(getContextWindow('some-future-model'), 1_048_576)
  assert.equal(getContextWindow(null), 1_048_576)
})
