import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupSessions } from '../src/services/chat/sessionGroups.js'
import type { SessionSummary } from '../src/services/chat/types.js'

/** 测试里不需要真的文案，直接用 key 当标签 */
const t = (key: string) => key

const NOW = new Date('2026-11-21T12:00:00').getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

const session = (id: string, ageHours: number, pinned?: boolean): SessionSummary => ({
  id,
  title: id,
  createdAt: NOW - ageHours * HOUR,
  updatedAt: NOW - ageHours * HOUR,
  pinned,
})

test('置顶会话单独成组排在最前，不再出现在日期分组里', () => {
  // 列表按 updatedAt 倒序传入（store 就是这么排的），置顶的不改顺序也照样提到最前
  const groups = groupSessions(
    [session('today', 1), session('old', 24 * 40), session('pin', 24 * 40, true)],
    NOW,
    t
  )
  assert.equal(groups.length, 3)
  assert.equal(groups[0]?.key, 'sessionHistoryTimelineLabelPinned')
  assert.deepEqual(
    groups[0]?.sessions.map((item) => item.id),
    ['pin']
  )
  assert.equal(groups[1]?.key, 'sessionHistoryTimelineLabelToday')
  assert.deepEqual(
    groups[1]?.sessions.map((item) => item.id),
    ['today']
  )
  // 40 天前的置顶会话不会漏到月度分组
  assert.deepEqual(
    groups[2]?.sessions.map((item) => item.id),
    ['old']
  )
})

test('没有置顶会话时不出现置顶分组', () => {
  const groups = groupSessions([session('a', 1), session('b', 30)], NOW, t)
  assert.equal(groups[0]?.key, 'sessionHistoryTimelineLabelToday')
  assert.equal(
    groups.some((group) => group.key === 'sessionHistoryTimelineLabelPinned'),
    false
  )
})

test('置顶组保持传入顺序，不按时间重排', () => {
  const groups = groupSessions([session('newer', 1, true), session('older', DAY, true)], NOW, t)
  assert.deepEqual(
    groups[0]?.sessions.map((item) => item.id),
    ['newer', 'older']
  )
})
