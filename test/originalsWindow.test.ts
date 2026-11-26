import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextOriginalsEnd, ORIGINALS_ROUNDS, pinnedFromSentinel } from '../src/components/messages/originalsWindow.js'

/** 造 n 轮：每轮一条提问 + 一条回复 */
const rounds = (n: number) =>
  Array.from({ length: n }, (_, index) => [
    { role: 'user' as const, id: `u${index}` },
    { role: 'assistant' as const, id: `a${index}` },
  ]).flat()

test('一批取满 5 轮，下标停在第 6 条提问上', () => {
  const messages = rounds(6)
  assert.equal(ORIGINALS_ROUNDS, 5)
  assert.equal(nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS), 10)
  // 第 10 条正是第 6 轮的问题，留给下一次点击
  assert.equal(messages[10].role, 'user')
})

test('剩下不足一批就一起给完', () => {
  const messages = rounds(3)
  assert.equal(nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS), 6)
})

test('从中间接着取，边界仍落在提问上，一问一答不会被切开', () => {
  const messages = rounds(12)
  const end = nextOriginalsEnd(messages, 10, ORIGINALS_ROUNDS)
  assert.equal(end, 20)
  assert.equal(messages[end - 1].role, 'assistant')
})

test('起点落在回复上时，这一轮算已开始，不重复计算', () => {
  const messages = rounds(8)
  // 从第 1 条（第一条回复）开始：它属于第 1 轮，因此这一批只再吃 4 轮
  const end = nextOriginalsEnd(messages, 1, ORIGINALS_ROUNDS)
  assert.equal(end, 10)
})

test('最后一条提问的回复一定被带上', () => {
  const messages = [
    { role: 'user', id: 'u0' },
    { role: 'assistant', id: 'a0' },
    { role: 'user', id: 'u1' },
    { role: 'assistant', id: 'a1' },
    { role: 'assistant', id: 'a1-v2' },
  ]
  assert.equal(nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS), 5)
})

test('一条提问都没有时整段给完，不会点了不动', () => {
  const messages = [
    { role: 'assistant', id: 'a0' },
    { role: 'assistant', id: 'a1' },
  ]
  assert.equal(nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS), 2)
})

test('已经到底、或者一批要求 0 轮，原样返回', () => {
  const messages = rounds(2)
  assert.equal(nextOriginalsEnd(messages, 4, ORIGINALS_ROUNDS), 4)
  assert.equal(nextOriginalsEnd(messages, 0, 0), 0)
  assert.equal(nextOriginalsEnd([], 0, ORIGINALS_ROUNDS), 0)
})

test('连续点下去一定能走到末尾，不会原地打转', () => {
  const messages = rounds(23)
  let shown = nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS)
  let clicks = 0
  while (shown < messages.length) {
    const next = nextOriginalsEnd(messages, shown, ORIGINALS_ROUNDS)
    assert.ok(next > shown, `第 ${clicks + 1} 次点击没有前进：${shown} → ${next}`)
    shown = next
    clicks += 1
    assert.ok(clicks < 100, '点击次数异常')
  }
  assert.equal(shown, messages.length)
})

test('卡片吸顶：原文块还没被滑过去时继续贴着', () => {
  // 哨兵在视口里，或者还在视口下方（原文块没读完）
  assert.equal(pinnedFromSentinel(300, 100), true)
  assert.equal(pinnedFromSentinel(600, 100), true)
})

test('卡片吸顶：哨兵越过容器顶边就松手', () => {
  assert.equal(pinnedFromSentinel(50, 100), false)
  assert.equal(pinnedFromSentinel(-200, 100), false)
})

test('卡片吸顶：正好压在顶边那一刻算还没过去，贴着边界停住不会来回抖', () => {
  assert.equal(pinnedFromSentinel(100, 100), true)
})
