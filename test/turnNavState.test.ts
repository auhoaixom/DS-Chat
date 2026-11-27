import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearTurnNav,
  publishTurnNav,
  setActiveTurn,
  useTurnNav,
} from '../src/components/turns/turnNavState.js'
import type { TurnRow } from '../src/components/turns/turnRows.js'

const rows = (count: number): TurnRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    kind: 'text' as const,
    text: `问题 ${index}`,
  }))

const publish = (over: {
  sessionId?: string
  rows?: TurnRow[]
  revealed?: number
  remaining?: number
  expandable?: boolean
  compactedAbove?: boolean
  expandOlder?: () => void
  jumpToTurn?: (id: string) => void
}) => {
  const state = useTurnNav.getState()
  publishTurnNav({
    sessionId: over.sessionId ?? state.sessionId,
    rows: over.rows ?? state.rows,
    older: {
      revealed: over.revealed ?? state.older.revealed,
      remaining: over.remaining ?? state.older.remaining,
    },
    expandable: over.expandable ?? state.expandable,
    compactedAbove: over.compactedAbove ?? state.compactedAbove,
    expandOlder: over.expandOlder ?? state.expandOlder,
    jumpToTurn: over.jumpToTurn ?? state.jumpToTurn,
  })
}

test('写入之后抽屉读到同一批行与两个数字', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(10), revealed: 10, remaining: 37, expandable: true })
  const state = useTurnNav.getState()
  assert.equal(state.sessionId, 's1')
  assert.equal(state.rows.length, 10)
  assert.deepEqual(state.older, { revealed: 10, remaining: 37 })
  assert.equal(state.expandable, true)
  assert.equal(state.compactedAbove, false)
})

test('内容没变时不写：行数组的引用也不换，避免流式时重渲整棵目录', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(10), revealed: 10, remaining: 37 })
  const before = useTurnNav.getState()
  publish({ rows: rows(10) })
  const after = useTurnNav.getState()
  assert.equal(after, before, 'state 对象应当是同一个')
  assert.equal(after.rows, before.rows)
})

test('内容变了才换引用', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(10) })
  const before = useTurnNav.getState().rows
  publish({ rows: rows(11) })
  assert.notEqual(useTurnNav.getState().rows, before)
  assert.equal(useTurnNav.getState().rows.length, 11)
})

test('换会话时把当前轮清掉，别让新会话先高亮旧的一行', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(3) })
  setActiveTurn('m1')
  assert.equal(useTurnNav.getState().activeTurnId, 'm1')
  publish({ sessionId: 's2' })
  assert.equal(useTurnNav.getState().activeTurnId, null)
})

test('当前轮同一个值不重复写', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(3) })
  setActiveTurn('m2')
  const before = useTurnNav.getState()
  setActiveTurn('m2')
  assert.equal(useTurnNav.getState(), before)
})

test('清空之后什么都不剩，抽屉里不会留着上一段对话的目录', () => {
  clearTurnNav()
  publish({ sessionId: 's1', rows: rows(3), revealed: 3, remaining: 9, expandable: true, compactedAbove: true })
  setActiveTurn('m1')
  clearTurnNav()
  const state = useTurnNav.getState()
  assert.equal(state.sessionId, null)
  assert.equal(state.rows.length, 0)
  assert.deepEqual(state.older, { revealed: 0, remaining: 0 })
  assert.equal(state.expandable, false)
  assert.equal(state.compactedAbove, false)
  assert.equal(state.activeTurnId, null)
})

test('两个动作能被抽屉拿到并调用', () => {
  clearTurnNav()
  let expanded = 0
  let jumped = ''
  publish({
    sessionId: 's1',
    expandOlder: () => {
      expanded += 1
    },
    jumpToTurn: (id) => {
      jumped = id
    },
  })
  const state = useTurnNav.getState()
  state.expandOlder()
  state.jumpToTurn('m7')
  assert.equal(expanded, 1)
  assert.equal(jumped, 'm7')
})
