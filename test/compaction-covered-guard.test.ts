import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCoveredBranchPoint, isCoveredMessage } from '../src/services/chat/compaction.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { compactionRecord, userMessage } from './helpers.js'

/**
 * 硬性规定：被压缩盖掉的那段对话不许编辑、不许切版本、不许重答、不许继续。
 *
 * 理由不是"数据会坏"，而是**摘要讲的是那一刻那段原文**：改动覆盖段里的任何一条，
 * 摘要就会描述一段已经不存在的对话，而面板上没有任何异常提示——
 * 请求里带着用户以为自己已经改掉的内容，模型据此继续推理。
 *
 * 判据必须和界面用同一个数（`getCoveredCount`）：界面藏掉几条，就是几条不可操作。
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
 * u1 → a1（当前）/ a1b
 *      └ u2 → a2（当前）/ a2b
 * 当前路径：[u1, a1, u2, a2]
 */
const tree = (coveredIds: string[]): Session => {
  const messages: Message[] = [
    { ...userMessage('第一问', 'u1'), parentId: null, selectedChildId: 'a1' },
    { ...reply('a1', '第一答'), parentId: 'u1', selectedChildId: 'u2' },
    { ...reply('a1b', '第一答（另一版）'), parentId: 'u1' },
    { ...userMessage('第二问', 'u2'), parentId: 'a1', selectedChildId: 'a2' },
    { ...reply('a2', '第二答'), parentId: 'u2' },
    { ...reply('a2b', '第二答（另一版）'), parentId: 'u2' },
  ]
  return {
    id: 's1',
    title: '守卫',
    createdAt: 0,
    updatedAt: 0,
    messages,
    rootMessageId: 'u1',
    ...(coveredIds.length > 0
      ? { compaction: compactionRecord({ coveredIds, createdAt: 10, summary: '旧开头' }) }
      : {}),
  }
}

test('覆盖段里的消息被认出来，保留段和路径外的都不算', () => {
  const session = tree(['u1', 'a1'])
  assert.equal(isCoveredMessage(session, 'u1'), true)
  assert.equal(isCoveredMessage(session, 'a1'), true)
  assert.equal(isCoveredMessage(session, 'u2'), false, '保留段照常可编辑')
  assert.equal(isCoveredMessage(session, 'a2'), false)
  // 兄弟版本本身不在当前路径上：它不会被"编辑"，能动的只有"切过去"这个动作
  assert.equal(isCoveredMessage(session, 'a1b'), false)
  assert.equal(isCoveredMessage(session, '不存在的'), false)
})

test('没有压缩记录、或覆盖段失效时，谁都不冻结', () => {
  assert.equal(isCoveredMessage(tree([]), 'u1'), false)
  // 覆盖段在这条路径上不连续（导入的包/脏数据）：整次忽略，原文照常进请求，也就不该冻
  const dirty = tree(['u1', 'a2'])
  assert.equal(isCoveredMessage(dirty, 'u1'), false)
  assert.equal(isCoveredMessage(dirty, 'a2'), false)
})

test('在覆盖段内部岔分支算越界，末尾与保留段不算', () => {
  const session = tree(['u1', 'a1'])
  // 切到 a1 的兄弟：岔口在 u1，覆盖段后半截（a1）会离开路径
  assert.equal(isCoveredBranchPoint(session, 'a1b'), true)
  // 切到 a2 的兄弟：岔口在 u2，覆盖段原样不动
  assert.equal(isCoveredBranchPoint(session, 'a2b'), false)
  // 换根等于换掉第一条，一定在覆盖段里
  const withExtraRoot: Session = {
    ...session,
    messages: [...session.messages, { ...userMessage('另一个开头', 'u0b'), parentId: null }],
  }
  assert.equal(isCoveredBranchPoint(withExtraRoot, 'u0b'), true)
})

test('只盖住第一条时，切第二条的版本照常允许', () => {
  // 覆盖段 [u1]，岔口在 u1（最后一条覆盖消息）→ 覆盖段不动
  const session = tree(['u1'])
  assert.equal(isCoveredMessage(session, 'u1'), true)
  assert.equal(isCoveredBranchPoint(session, 'a1b'), false, '边界那一条不该被误伤')
  assert.equal(isCoveredBranchPoint(session, 'a2b'), false)
})

test('没有压缩时什么都不拦', () => {
  const session = tree([])
  assert.equal(isCoveredBranchPoint(session, 'a1b'), false)
  assert.equal(isCoveredBranchPoint(session, 'u0b'), false)
})
