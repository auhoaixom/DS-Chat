import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_MESSAGES,
  clampWindowStart,
  initialWindowStart,
} from '../src/components/messages/messageWindow.js'

test('新开一条 234 条的对话：从第 214 条开始，挂末尾一屏', () => {
  assert.equal(initialWindowStart(234), 234 - INITIAL_MESSAGES)
  assert.equal(clampWindowStart(214, 234), 214)
})

test('消息数没变时，记下的起点原样保留', () => {
  for (const start of [0, 1, 100, 214]) {
    assert.equal(clampWindowStart(start, 234), start)
  }
})

test('压缩之后可见消息变少：仍至少留够一屏，不会缩成一条', () => {
  // 打开 234 条时起点是 214；压缩后只剩 30 条可见
  const start = clampWindowStart(214, 30)
  assert.equal(start, 10)
  assert.equal(30 - start, INITIAL_MESSAGES, '渲染条数必须是一屏，不是一条')
})

test('可见消息比一屏还少时从 0 开始（全挂）', () => {
  assert.equal(clampWindowStart(214, 5), 0)
  assert.equal(clampWindowStart(214, 0), 0)
  assert.equal(clampWindowStart(0, 0), 0)
})

test('这个坑长什么样：按「最后一条」钳位会让 30 条只剩 1 条', () => {
  // v0.9.17 的第一版就是这么写的，v0.9.18 修掉；这里把错误写法定住，防止改回去
  const buggy = (windowStart: number, messageCount: number) =>
    Math.min(windowStart, Math.max(0, messageCount - 1))
  assert.equal(30 - buggy(214, 30), 1)
  assert.notEqual(clampWindowStart(214, 30), buggy(214, 30))
})
