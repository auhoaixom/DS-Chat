import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTENT_VERSION, upgradeSession } from '../src/services/chat/contentVersion.js'
import type { Session } from '../src/services/chat/types.js'
import { compactionRecord, userMessage } from './helpers.js'

/** 版本机制之前写进库里的记录：没有 schema 字段 */
const legacySession = (): Session => ({
  id: 'old',
  title: '旧记录',
  createdAt: 1,
  updatedAt: 2,
  messages: [userMessage('问', 'old-m1')],
  rootMessageId: 'old-m1',
  compaction: compactionRecord({ coveredIds: ['old-m1'], summary: '旧的摘要' }),
})

test('没有版本号的旧记录：打上当前版本，并标出早期摘要', () => {
  const record = legacySession()
  const result = upgradeSession(record)

  assert.equal(result.fromFuture, false)
  assert.notEqual(result.session, record)
  assert.equal(result.session.schema, CONTENT_VERSION)
  assert.equal(result.session.compaction?.legacy, true)

  // 迁移只做这两件事：别的字段一律照抄
  assert.equal(result.session.compaction?.summary, '旧的摘要')
  assert.deepEqual(result.session.compaction?.coveredIds, ['old-m1'])
  assert.equal(result.session.compaction?.beforeTokens, 1_000)
  assert.equal(result.session.compaction?.afterTokens, 100)
  assert.deepEqual(result.session.messages, record.messages)

  // 原对象不能被就地改写：写回是调用方的事
  assert.equal(record.schema, undefined)
  assert.equal(record.compaction?.legacy, undefined)
})

test('没有压缩记录的旧会话：只打版本号，不凭空造出 legacy', () => {
  const record: Session = { id: 'plain', title: '空会话', createdAt: 1, updatedAt: 1, messages: [] }
  const result = upgradeSession(record)

  assert.notEqual(result.session, record)
  assert.equal(result.session.schema, CONTENT_VERSION)
  assert.equal('compaction' in result.session, false)
})

test('已经是当前版本的记录：原样返回同一个对象，不需要写回', () => {
  const record: Session = {
    ...legacySession(),
    schema: CONTENT_VERSION,
    compaction: compactionRecord({ legacy: true }),
  }
  const result = upgradeSession(record)

  assert.equal(result.session, record)
  assert.equal(result.fromFuture, false)
})

test('比本程序新的记录：只用不改，绝不写回', () => {
  const record: Session = {
    ...legacySession(),
    schema: CONTENT_VERSION + 1,
    compaction: compactionRecord({ summary: '更新的摘要' }),
  }
  const result = upgradeSession(record)

  assert.equal(result.session, record)
  assert.equal(result.fromFuture, true)
  // 不许给它补版本号，也不许给它的摘要扣一顶「早期版本」的帽子
  assert.equal(result.session.schema, CONTENT_VERSION + 1)
  assert.equal(result.session.compaction?.legacy, undefined)
  assert.equal(result.session.compaction?.summary, '更新的摘要')
})
