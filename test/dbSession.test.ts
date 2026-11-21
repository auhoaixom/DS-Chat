import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toStoredSummary, withPinned, withTitle } from '../src/services/chat/db.js'
import type { Session } from '../src/services/chat/types.js'
import { assistantMessage, compactionRecord, imageFile, userMessage } from './helpers.js'

/**
 * 这些断言守的是一件事故：会话在**写回**时被摘要重建，compaction 与 messages 被洗掉。
 * 重命名、置顶都走"整条读出 → 改一个字段 → 原样写回"，谁改成用摘要拼一个会话，
 * 这几条会立刻红。
 */
const session = (): Session => {
  const user = { ...userMessage('问题', 'm1'), files: [imageFile('f1'), imageFile('f1')] }
  const reply = { ...assistantMessage('回答', 'm2'), status: 'done' as const }
  return {
    id: 's1',
    title: '原标题',
    createdAt: 1,
    updatedAt: 2,
    messages: [user, reply],
    compaction: compactionRecord({ coveredIds: ['m1'], summary: '摘要正文', createdAt: 3 }),
    pinned: true,
  }
}

test('列表摘要只带元数据：有标题、置顶、去重后的文件 id，没有 messages 与 compaction', () => {
  const summary = toStoredSummary(session())
  assert.equal(summary.id, 's1')
  assert.equal(summary.title, '原标题')
  assert.equal(summary.pinned, true)
  assert.deepEqual(summary.fileIds, ['f1'])
  // 摘要进了列表就等于把整段对话读进内存，也等于给"用摘要重建会话"留下了机会
  assert.equal('messages' in summary, false)
  assert.equal('compaction' in summary, false)
})

test('重命名只改标题：compaction 与 messages 原样保留', () => {
  const before = session()
  const after = withTitle(before, '新标题')
  assert.equal(after.title, '新标题')
  assert.equal(after.compaction, before.compaction)
  assert.equal(after.messages, before.messages)
  assert.equal(after.pinned, before.pinned)
  // 原对象不动
  assert.equal(before.title, '原标题')
})

test('置顶与取消置顶都保留 compaction，取消时字段整个消失', () => {
  const unpinned = withPinned({ ...session(), pinned: undefined }, true)
  assert.equal(unpinned.pinned, true)
  assert.equal(unpinned.compaction?.summary, '摘要正文')

  const back = withPinned(unpinned, false)
  assert.equal('pinned' in back, false)
  assert.equal(back.compaction, unpinned.compaction)
  assert.equal(back.messages, unpinned.messages)
})
