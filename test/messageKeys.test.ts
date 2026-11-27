import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageKey, messageKeys } from '../src/components/messages/messageKeys.js'
import { appendBranch, normalizeSession } from '../src/services/chat/branches.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { assistantMessage, at, conversation, userMessage } from './helpers.js'

const sessionOf = (messages: Message[]): Session => ({
  id: 's1',
  title: 'key 测试',
  createdAt: 0,
  updatedAt: 0,
  messages,
})

test('一轮问答里提问和回答的 key 必须不同', () => {
  const session = normalizeSession(sessionOf(conversation(1)))
  const question = at(session.messages, 0)
  const reply = at(session.messages, 1)
  // 回答的 parentId 就是提问的 id：只取 id 的话两者会是同一个字符串
  assert.equal(reply.parentId, question.id)
  assert.notEqual(messageKey(question), messageKey(reply))
})

test('导入包里的数字 id 同样不撞', () => {
  // 归档里的消息 id 是 1、2、3……，回答的 parent_id 指回提问
  assert.equal(messageKey({ id: '3', role: 'user' }), 'u:3')
  assert.equal(messageKey({ id: '4', role: 'assistant', parentId: '3' }), 'a:3')
  assert.notEqual(messageKey({ id: '3', role: 'user' }), messageKey({ id: '4', role: 'assistant', parentId: '3' }))
})

test('整条对话的 key 互不重复，挂末尾一段时也是', () => {
  const session = normalizeSession(sessionOf(conversation(11)))
  assert.equal(session.messages.length, 22)
  const all = messageKeys(session.messages)
  assert.equal(new Set(all).size, all.length)
  // 首屏挂末尾 10 轮（这里只有 11 轮，所以是后 10 轮、第 3 条起）、补载后挂全部 22 条，
  // 两种都要唯一 —— 重复时 React 会复制已显示过的提问
  for (const shown of [session.messages.slice(2), session.messages]) {
    assert.equal(new Set(messageKeys(shown)).size, shown.length)
  }
})

test('同一轮的两个回答版本共用一个 key，换版本时复用同一个组件实例', () => {
  const session = normalizeSession(sessionOf(conversation(1)))
  const question = at(session.messages, 0)
  const branched = appendBranch(session, question.id, [assistantMessage('另一个版本')])
  const replies = branched.messages.filter((message) => message.role === 'assistant')
  assert.equal(replies.length, 2)
  assert.equal(messageKey(at(replies, 0)), messageKey(at(replies, 1)))
  // 但版本和它的提问仍然分开
  assert.notEqual(messageKey(question), messageKey(at(replies, 0)))
})

test('提问自己的多个版本各用各的 key', () => {
  // 提问版本是不同 id，key 跟着 id 走，不会因为共用一个父消息而合并
  const first = userMessage('问题', 'x1')
  const second = userMessage('问题（改过）', 'x2')
  assert.notEqual(messageKey(first), messageKey(second))
})
