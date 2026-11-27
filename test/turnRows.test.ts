import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeTurnOf,
  sameTurnRows,
  swipeIntent,
  turnRows,
  type TurnRow,
} from '../src/components/turns/turnRows.js'
import {
  assistantMessage,
  conversation,
  documentFile,
  imageFile,
  userMessage,
} from './helpers.js'

// ── 行数据 ───────────────────────────────────────────────────────────────────

test('一行 = 一轮 = 一条提问，回答不产出行', () => {
  const rows = turnRows(conversation(3))
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['text', 'text', 'text']
  )
})

test('顺序原样：旧在前、新在后，与消息界面同向', () => {
  const first = userMessage('第一个问题')
  const second = userMessage('第二个问题')
  const rows = turnRows([first, assistantMessage('答一'), second, assistantMessage('答二')])
  assert.deepEqual(
    rows.map((row) => row.id),
    [first.id, second.id]
  )
})

test('只有图片的提问显示成图片', () => {
  const message: ReturnType<typeof userMessage> = {
    ...userMessage(''),
    files: [imageFile('f1'), imageFile('f2')],
  }
  assert.deepEqual(turnRows([message]), [{ id: message.id, kind: 'image', text: '' }])
})

test('带文档的提问显示成附件（图片 + 文档也算附件）', () => {
  const onlyDoc = { ...userMessage(''), files: [documentFile('d1')] }
  const mixed = { ...userMessage('  '), files: [imageFile('f1'), documentFile('d2')] }
  assert.equal(turnRows([onlyDoc])[0]?.kind, 'file')
  assert.equal(turnRows([mixed])[0]?.kind, 'file')
})

test('有正文就显示正文，附件不参与', () => {
  const message = { ...userMessage('  这条有字  '), files: [documentFile('d1')] }
  assert.deepEqual(turnRows([message]), [{ id: message.id, kind: 'text', text: '这条有字' }])
})

test('既没正文也没附件：留一个占位行，不让这一轮凭空消失', () => {
  const message = userMessage('   ')
  assert.equal(turnRows([message])[0]?.kind, 'empty')
})

// ── 当前轮 ───────────────────────────────────────────────────────────────────

test('阅读线以上最后一轮就是当前轮', () => {
  const rects = [
    { id: 'a', top: -400 },
    { id: 'b', top: 10 },
    { id: 'c', top: 300 },
  ]
  assert.equal(activeTurnOf(rects, 96), 'b')
  assert.equal(activeTurnOf(rects, 500), 'c')
  assert.equal(activeTurnOf(rects, -400), 'a')
  assert.equal(activeTurnOf(rects, -900), null)
  assert.equal(activeTurnOf([], 96), null)
})

// ── 横滑意向 ─────────────────────────────────────────────────────────────────

test('都关着：右滑开左、左滑开右', () => {
  const base = { leftOpen: false, rightOpen: false, rightEnabled: true }
  assert.equal(swipeIntent({ ...base, dx: 40 }), 'open-left')
  assert.equal(swipeIntent({ ...base, dx: -40 }), 'open-right')
})

test('右抽屉不可用时，左滑不接手', () => {
  assert.equal(
    swipeIntent({ leftOpen: false, rightOpen: false, rightEnabled: false, dx: -40 }),
    null
  )
  // 右滑照常开左
  assert.equal(
    swipeIntent({ leftOpen: false, rightOpen: false, rightEnabled: false, dx: 40 }),
    'open-left'
  )
})

test('开着的时候只认闭合方向', () => {
  assert.equal(
    swipeIntent({ leftOpen: true, rightOpen: false, rightEnabled: true, dx: -40 }),
    'close-left'
  )
  assert.equal(
    swipeIntent({ leftOpen: true, rightOpen: false, rightEnabled: true, dx: 40 }),
    null
  )
  assert.equal(
    swipeIntent({ leftOpen: false, rightOpen: true, rightEnabled: true, dx: 40 }),
    'close-right'
  )
  assert.equal(
    swipeIntent({ leftOpen: false, rightOpen: true, rightEnabled: true, dx: -40 }),
    null
  )
})

// ── 行数据比较（避免流式时重渲整棵目录） ───────────────────────────────────
test('内容一样的两批行算相同，改一个字就不算', () => {
  const a: TurnRow[] = [{ id: 'm1', kind: 'text', text: '问题' }]
  const b: TurnRow[] = [{ id: 'm1', kind: 'text', text: '问题' }]
  assert.equal(sameTurnRows(a, b), true)
  assert.equal(sameTurnRows(a, a), true)
  assert.equal(sameTurnRows(a, [{ id: 'm1', kind: 'text', text: '问 题' }]), false)
  assert.equal(sameTurnRows(a, []), false)
  assert.equal(sameTurnRows([], []), true)
})
