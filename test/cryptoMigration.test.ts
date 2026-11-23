import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDB } from 'idb'
import * as db from '../src/services/chat/db.js'
import { needsEncryption, runEncryptionMigration } from '../src/services/crypto/migration.js'
import type { Session } from '../src/services/chat/types.js'
import { assistantMessage, userMessage } from './helpers.js'

/**
 * 一次性加密迁移。
 *
 * 要守住的是三条：内容一个字都不能变、跑两遍结果一样、中途中断能接着来。
 * 中断续跑靠「记录形状」判断而不是游标位置，所以第二条用例直接绕过状态标记
 * 调底层那一轮，模拟「加密完还没打标记就被杀掉」。
 */

const plainSession = (id: string, text: string): Session => ({
  id,
  title: `标题-${id}`,
  createdAt: 1,
  updatedAt: 2,
  messages: [userMessage(text, `${id}-m1`), assistantMessage('回答', `${id}-m2`)],
})

/** 直接把明文写进存储，模拟升级前的旧库 */
const putPlain = async (session: Session) => {
  const raw = await openDB('chat-demo')
  await raw.put('sessions', session)
  raw.close()
}

const rawRecord = async (store: string, key: string): Promise<unknown> => {
  const raw = await openDB('chat-demo')
  const record = await raw.get(store, key)
  raw.close()
  return record
}

/** db.ts 的库要在直接操作存储之前建好，否则拿到的是空的 v1 库 */
const ensureSchema = () => db.countSessions()

test('明文记录就地加密：内容不变，读回来还是原文', async () => {
  await ensureSchema()
  const session = plainSession('m-a', '迁移前的明文对话')
  await putPlain(session)

  assert.equal(await needsEncryption(), true)

  const { failed } = await runEncryptionMigration()
  assert.deepEqual(failed, [])
  assert.equal(await needsEncryption(), false)

  assert.deepEqual(await db.loadSession('m-a'), session)
  const raw = await rawRecord('sessions', 'm-a')
  assert.ok(db.isSealedSession(raw))
  assert.equal(JSON.stringify(raw).includes('迁移前的明文对话'), false)
})

test('中断后重跑：已加密的按形状跳过，不会二次加密', async () => {
  const session = plainSession('m-b', '第二轮才出现的对话')
  await putPlain(session)

  const first = await db.sealAllSessions()
  assert.equal(first.sealed, 1)
  assert.deepEqual(first.failed, [])

  // 本轮没来得及写完成标记（模拟被杀）——再跑一次，靠形状判断跳过
  const second = await db.sealAllSessions()
  assert.equal(second.sealed, 0)
  assert.deepEqual(second.failed, [])

  assert.deepEqual(await db.loadSession('m-b'), session)
})

test('迁移上报进度，最后一次的 done 等于总数', async () => {
  await putPlain(plainSession('m-c', '第三条'))
  await putPlain(plainSession('m-d', '第四条'))

  const seen: { done: number; total: number }[] = []
  await db.sealAllSessions((done, total) => seen.push({ done, total }))

  assert.ok(seen.length >= 1)
  const last = seen.at(-1)
  assert.ok(last)
  assert.equal(last.done, last.total)
  assert.ok(last.total >= 2)
})

test('还没迁移的明文记录照常能读：迁移窗口期不会读不出东西', async () => {
  const session = plainSession('m-e', '迁移中途')
  await putPlain(session)
  assert.deepEqual(await db.loadSession('m-e'), session)
})
