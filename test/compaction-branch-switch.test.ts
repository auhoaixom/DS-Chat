import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCompaction, getContextUsage, getCoveredCount } from '../src/services/chat/compaction.js'
import { getVisibleMessages, selectVersion } from '../src/services/chat/branches.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { compactionRecord, userMessage } from './helpers.js'

/**
 * 覆盖段与当前路径对不上时怎么办。
 *
 * 规则是"请求里只有开头连续前缀才用摘要替换"。**界面上走不到这里**：
 * 覆盖段里的版本切不动、也不能编辑（见 `isCoveredBranchPoint` 的硬性规定），
 * 所以正常操作下覆盖段永远仍是当前路径的前缀。
 *
 * 但导入的包、旧版本写下的数据、外部工具改过的归档都能造出"对不上"的状态，
 * 这里守的是那种情况：按新路径重新裁剪，裁不干净就整次作废——
 * 绝不能把摘要硬套在一段对不上的对话上。
 */

const reply = (id: string, text: string) => ({
  id,
  role: 'assistant' as const,
  createdAt: 0,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text }],
})

/**
 * u1 → a1（当前） / a2（另一个版本）；a1 → u2 → r2
 * 当前路径：[u1, a1, u2, r2]
 */
const tree = (): { session: Session; u1: Message; a1: Message; a2: Message; r2: Message } => {
  const u1 = userMessage('第一问', 'u1')
  const a1 = reply('a1', '第一答')
  const a2 = reply('a2', '第一答（另一个版本）')
  const u2 = userMessage('第二问', 'u2')
  const r2 = reply('r2', '第二答')
  const messages: Message[] = [
    { ...u1, parentId: null, selectedChildId: 'a1' },
    { ...a1, parentId: 'u1', selectedChildId: 'u2' },
    { ...a2, parentId: 'u1' },
    { ...u2, parentId: 'a1', selectedChildId: 'r2' },
    { ...r2, parentId: 'u2' },
  ]
  const session: Session = {
    id: 's1',
    title: '分支',
    createdAt: 0,
    updatedAt: 0,
    messages,
    rootMessageId: 'u1',
  }
  return { session, u1: messages[0] as Message, a1: messages[1] as Message, a2: a2 as Message, r2: r2 as Message }
}

test('覆盖段只剩一部分在当前路径上：按新路径重新裁剪', () => {
  const { session, a2 } = tree()
  const compacted: Session = {
    ...session,
    compaction: compactionRecord({ coveredIds: ['u1', 'a1'], createdAt: 10, summary: '被压掉的旧开头' }),
  }

  // 压缩当时：两条都被盖住
  assert.equal(getCoveredCount(getVisibleMessages(compacted), compacted.compaction), 2)

  const switched = selectVersion(compacted, a2.id)
  assert.deepEqual(
    getVisibleMessages(switched).map((message) => message.id),
    ['u1', 'a2'],
    '前提：切到了另一条分支'
  )

  const applied = applyCompaction(getVisibleMessages(switched), switched.compaction)
  // 按新路径重新裁剪：只剩第一条还在覆盖段里
  assert.equal(applied.summary, '被压掉的旧开头')
  assert.deepEqual(
    applied.history.map((message) => message.id),
    ['a2']
  )
  assert.equal(getCoveredCount(getVisibleMessages(switched), switched.compaction), 1)

  const usage = getContextUsage(switched)
  assert.ok(usage)
  assert.equal(usage.compacted, true)
  assert.ok(usage.summaryTokens > 0)
})

test('覆盖段在这条分支上不连续时，整次压缩作废、原文照常回传', () => {
  const { session } = tree()
  const dirty: Session = {
    ...session,
    // u1 和 r2 之间隔着 a1、u2：这不是任何一条路径的前缀（导入的包、旧版本的脏数据会长这样）
    compaction: compactionRecord({ coveredIds: ['u1', 'r2'], createdAt: 10, summary: '说不清盖了哪段' }),
  }

  const applied = applyCompaction(getVisibleMessages(dirty), dirty.compaction)
  assert.equal(applied.summary, null, '盖不住的压缩必须整次忽略，不能套一半')
  assert.deepEqual(
    applied.history.map((message) => message.id),
    ['u1', 'a1', 'u2', 'r2'],
    '原文一条不少地回传'
  )
  assert.equal(getCoveredCount(getVisibleMessages(dirty), dirty.compaction), 0)

  const usage = getContextUsage(dirty)
  assert.ok(usage)
  assert.equal(usage.compacted, false, '面板也不许说"已压缩"')
  assert.equal(usage.summaryTokens, 0)
})
