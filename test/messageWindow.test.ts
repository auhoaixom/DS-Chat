import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_TURNS,
  OLDER_TURNS,
  clampWindowStart,
  compactedAtTop,
  countTurns,
  expandOlderStart,
  initialWindowStart,
  olderTurnCounts,
  turnWindowStart,
} from '../src/components/messages/messageWindow.js'

/** 一问一答交替的列表，长度 count*2 */
const pairs = (count: number) =>
  Array.from({ length: count }).flatMap(() => [
    { role: 'user' as const },
    { role: 'assistant' as const },
  ])

/** count 轮完整问答，末尾再加一条还没回答的提问 */
const withBareQuestion = (count: number) => [...pairs(count), { role: 'user' as const }]

test('新开一条 234 条的对话：从第 214 条开始，挂末尾十轮', () => {
  const messages = pairs(117) // 234 条 = 117 轮
  assert.equal(initialWindowStart(messages), 214)
  assert.equal(clampWindowStart(214, messages), 214)
})

test('起点总是落在提问上', () => {
  for (const turns of [1, 2, 5, 10, 117]) {
    const messages = pairs(117)
    assert.equal(messages[turnWindowStart(messages, turns)]?.role, 'user')
  }
})

test('消息数没变时，记下的起点原样保留', () => {
  const messages = pairs(117)
  for (const start of [0, 1, 100, 214]) {
    assert.equal(clampWindowStart(start, messages), start)
  }
})

test('压缩之后可见消息变少：仍至少留够十轮，不会缩成一条', () => {
  // 打开 234 条时起点是 214；压缩后只剩 30 条可见（15 轮）
  const messages = pairs(15)
  const start = clampWindowStart(214, messages)
  assert.equal(start, 10)
  assert.equal(countTurns(messages, start, messages.length), INITIAL_TURNS, '挂的是十轮，不是一条')
})

test('可见消息比十轮还少时从 0 开始（全挂）', () => {
  assert.equal(clampWindowStart(214, pairs(2)), 0)
  assert.equal(clampWindowStart(214, []), 0)
  assert.equal(clampWindowStart(0, []), 0)
})

test('这个坑长什么样：按「最后一条」钳位会让 15 轮只剩一条', () => {
  // v0.9.17 的第一版就是这么写的，v0.9.18 修掉；这里把错误写法定住，防止改回去
  const messages = pairs(15)
  const buggy = (windowStart: number, messageCount: number) =>
    Math.min(windowStart, Math.max(0, messageCount - 1))
  assert.equal(messages.length - buggy(214, messages.length), 1)
  assert.notEqual(clampWindowStart(214, messages), buggy(214, messages.length))
})

// ── 「展开更早的 N 轮」 ────────────────────────────────────────────────────────

test('点一次展开十轮，剩下的不够十轮时一次到底', () => {
  assert.equal(OLDER_TURNS, 10)
  const messages = pairs(30) // 60 条 = 30 轮
  assert.equal(expandOlderStart(messages, 40), 20)
  assert.equal(expandOlderStart(messages, 10), 0)
})

test('落点必须落在提问上：起点在回答上时，退到它前面那条提问', () => {
  const messages = pairs(30)
  // 起点 41 是回答，往前数十轮落在 22（提问）
  assert.equal(messages[41]?.role, 'assistant')
  assert.equal(expandOlderStart(messages, 41), 22)
  assert.equal(messages[22]?.role, 'user')
  assert.equal(countTurns(messages, 22, 41), OLDER_TURNS)
})

test('退不到十轮就取 0，不会返回负数', () => {
  const messages = [{ role: 'assistant' as const }, { role: 'assistant' as const }]
  assert.equal(expandOlderStart(messages, 1), 0)
  assert.equal(expandOlderStart(messages, 0), 0)
})

test('十轮不等于二十条：末尾有条没回答的提问时，挂的是十条提问', () => {
  const messages = withBareQuestion(12) // 25 条，13 轮
  const start = initialWindowStart(messages)
  assert.equal(messages[start]?.role, 'user')
  assert.equal(countTurns(messages, start, messages.length), INITIAL_TURNS)
  assert.equal(messages.length - start, 19, '十轮只占 19 条，不是一个固定条数')
})

// ── 压缩相关的东西什么时候才露面 ───────────────────────────────────────────

test('没展到头就不摆压缩卡片：上面还有可展开的轮时，压缩等于不存在', () => {
  assert.equal(compactedAtTop(0, 40), true)
  // 还有没挂载的轮：先给「展开更早」，卡片和灰字都不该出现
  assert.equal(compactedAtTop(6, 40), false)
  assert.equal(compactedAtTop(120, 40), false)
  // 没有压缩：展到头也没什么可说的
  assert.equal(compactedAtTop(0, 0), false)
})

// ── 按钮上的两个数字 ─────────────────────────────────────────────────────────

test('按钮写的轮数就是点下去真的会展开的轮数', () => {
  const messages = withBareQuestion(12)
  for (let start = 0; start <= messages.length; start += 1) {
    const counts = olderTurnCounts(messages, start)
    assert.equal(counts.revealed, countTurns(messages, counts.next, start))
    assert.equal(counts.remaining, countTurns(messages, 0, start))
    assert.ok(counts.revealed <= OLDER_TURNS)
    assert.ok(counts.revealed <= counts.remaining)
  }
})

test('最后一批：两个数字相等，展开后起点归零', () => {
  const messages = pairs(12) // 24 条，末尾十轮从第 4 条开始
  const start = initialWindowStart(messages)
  const counts = olderTurnCounts(messages, start)
  assert.equal(counts.remaining, 2)
  assert.equal(counts.revealed, 2)
  assert.equal(counts.next, 0)
})
