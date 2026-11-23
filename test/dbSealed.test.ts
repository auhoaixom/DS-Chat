import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDB } from 'idb'
import * as db from '../src/services/chat/db.js'
import type { Session } from '../src/services/chat/types.js'
import { assistantMessage, compactionRecord, imageFile, userMessage } from './helpers.js'

/**
 * 存储层的加密行为。
 *
 * 这里断言的重点不是「加解密对不对」（那是 crypto.test.ts），而是三条设计约束：
 * 1. 落盘的记录里一个字都搜不到明文；
 * 2. 改标题只重封 meta，不碰正文密文；
 * 3. 明文区只留索引与排序真正要用的字段。
 */

const SECRET_TEXT = '这是一段不该出现在磁盘上的对话'
const SECRET_TITLE = '带图的问题'
const SECRET_REPLY = '回答正文'
const SECRET_SUMMARY = '摘要正文'

const sample = (id: string, fileId = 'f1'): Session => ({
  id,
  title: SECRET_TITLE,
  createdAt: 100,
  updatedAt: 200,
  messages: [
    { ...userMessage(SECRET_TEXT, `${id}-m1`), files: [imageFile(fileId)] },
    assistantMessage(SECRET_REPLY, `${id}-m2`),
  ],
  compaction: compactionRecord({ coveredIds: [`${id}-m1`], summary: SECRET_SUMMARY }),
})

/** 绕开 db.ts，直接看存储里那条记录长什么样 */
const rawRecord = async (store: string, key: string): Promise<unknown> => {
  const raw = await openDB('chat-demo')
  const record = await raw.get(store, key)
  raw.close()
  return record
}

type SealedView = { meta: ArrayBuffer; body: ArrayBuffer }

const sealedView = async (store: string, key: string): Promise<SealedView> =>
  (await rawRecord(store, key)) as SealedView

test('会话落盘后存储里没有明文，读回来逐字段一致', async () => {
  const session = sample('s-plain')
  await db.saveSession(session)

  const raw = await rawRecord('sessions', 's-plain')
  assert.ok(db.isSealedSession(raw))
  const dump = JSON.stringify(raw)
  for (const secret of [SECRET_TEXT, SECRET_TITLE, SECRET_REPLY, SECRET_SUMMARY]) {
    assert.equal(dump.includes(secret), false, `明文泄漏：${secret}`)
  }

  assert.deepEqual(await db.loadSession('s-plain'), session)
})

test('摘要的标题也是密文，列表读出来是明文', async () => {
  await db.saveSession(sample('s-sum'))

  const raw = await rawRecord('sessionSummaries', 's-sum')
  assert.ok(db.isSealedSummary(raw))
  assert.equal(JSON.stringify(raw).includes(SECRET_TITLE), false)

  const list = await db.loadSessionSummaries()
  assert.equal(list.find((item) => item.id === 's-sum')?.title, SECRET_TITLE)
})

test('改名只重新封 meta，正文密文一个字节都没动', async () => {
  await db.saveSession(sample('s-rename'))
  const before = await sealedView('sessions', 's-rename')

  await db.renameSession('s-rename', '改过的标题')

  const after = await sealedView('sessions', 's-rename')
  assert.deepEqual(new Uint8Array(after.body), new Uint8Array(before.body))
  assert.notDeepEqual(new Uint8Array(after.meta), new Uint8Array(before.meta))

  const loaded = await db.loadSession('s-rename')
  assert.equal(loaded?.title, '改过的标题')
  assert.equal(loaded?.messages.length, 2)
})

test('置顶只改明文字段：meta 与 body 都不重封', async () => {
  await db.saveSession(sample('s-pin'))
  const before = await sealedView('sessions', 's-pin')

  await db.setSessionPinned('s-pin', true)

  const after = await sealedView('sessions', 's-pin')
  assert.deepEqual(new Uint8Array(after.meta), new Uint8Array(before.meta))
  assert.deepEqual(new Uint8Array(after.body), new Uint8Array(before.body))
  assert.equal((await db.loadSession('s-pin'))?.pinned, true)
  const list = await db.loadSessionSummaries()
  assert.equal(list.find((item) => item.id === 's-pin')?.pinned, true)
})

test('把 A 会话的密文挪到 B 上，解密直接失败', async () => {
  await db.saveSession(sample('s-aad-a'))
  await db.saveSession(sample('s-aad-b'))
  const a = await sealedView('sessions', 's-aad-a')
  const b = await sealedView('sessions', 's-aad-b')

  const raw = await openDB('chat-demo')
  await raw.put('sessions', { ...(b as object), meta: a.meta })
  raw.close()

  await assert.rejects(() => db.loadSession('s-aad-b'))
})

test('fileIds 留在明文区，删会话时不解密也能清理原件', async () => {
  await db.saveSession(sample('s-files', 'f-only'), [
    { id: 'f-only', blob: new Blob(['x']) },
  ])

  const raw = (await rawRecord('sessions', 's-files')) as { fileIds: string[] }
  assert.deepEqual(raw.fileIds, ['f-only'])
  assert.ok((await db.loadFile('f-only')) instanceof Blob)

  await db.deleteSession('s-files')
  assert.equal(await db.loadFile('f-only'), undefined)
})

test('加密途中被删除：写回放弃，会话不会复活', async () => {
  // 故意不 await：让保存的加密阶段和删除重叠。
  // 加密是异步的，那几毫秒里会话可能已经被删——没有这道闸，删掉的对话会自己回来。
  const saving = db.saveSession(sample('s-race', 'f-race'))
  const deleting = db.deleteSession('s-race')
  await Promise.all([saving, deleting])

  assert.equal(await db.loadSession('s-race'), undefined)
  const list = await db.loadSessionSummaries()
  assert.equal(list.some((item) => item.id === 's-race'), false)
})

test('导入暂存写进去就是密文，替换后能正常读出', async () => {
  await db.clearStaging()
  await db.addStagingSession(sample('s-staging'))

  const raw = await rawRecord('sessionsStaging', 's-staging')
  assert.ok(db.isSealedSession(raw))
  assert.equal(JSON.stringify(raw).includes(SECRET_TEXT), false)

  // 替换会清空正式存储，把暂存搬过来——顺序放在最后，别影响上面的用例
  const summaries = await db.commitStaging()
  assert.equal(summaries.find((item) => item.id === 's-staging')?.title, SECRET_TITLE)
  assert.deepEqual(await db.loadSession('s-staging'), sample('s-staging'))
})
