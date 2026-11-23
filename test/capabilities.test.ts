import assert from 'node:assert/strict'
import { test } from 'node:test'

import { supportsServerFeatures } from '../src/services/chat/capabilities.js'
import { serverTools } from '../src/services/chat/prompt.js'
import { toRequestMessages } from '../src/services/chat/reply.js'
import type { UserMessage } from '../src/services/chat/types.js'

const question = (text: string): UserMessage => ({
  id: 'u1',
  role: 'user',
  content: text,
  createdAt: 0,
  files: [],
})

test('flash 系列支持服务端能力，其它模型不支持', () => {
  assert.equal(supportsServerFeatures('deepseek-flash'), true)
  assert.equal(supportsServerFeatures('deepseek-v4.1-flash'), true)
  assert.equal(supportsServerFeatures('deepseek-v4-pro'), false)
  assert.equal(supportsServerFeatures('deepseek-v4.1-pro'), false)
  assert.equal(supportsServerFeatures(''), false)
})

test('非 flash 模型不再声明服务端工具', () => {
  assert.deepEqual(serverTools('deepseek-v4-pro', true), [])
  assert.deepEqual(serverTools('deepseek-v4-pro', false), [])
  assert.deepEqual(serverTools('deepseek-flash', false), [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ])
  assert.deepEqual(serverTools('deepseek-flash', true), [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
    { type: 'deepseek_web_search', name: 'deepseek_web_search' },
  ])
})

test('非 flash 模型的请求里没有 latest_reminder 角色消息', () => {
  const withFeatures = toRequestMessages([], question('你好'), undefined, false, '2026-11-23,星期日')
  assert.ok(withFeatures.some((message) => message.role === 'latest_reminder'))

  const withoutFeatures = toRequestMessages(
    [],
    question('你好'),
    undefined,
    false,
    '2026-11-23,星期日',
    false
  )
  assert.ok(!withoutFeatures.some((message) => message.role === 'latest_reminder'))
  assert.equal(withoutFeatures.length, 1)
})
