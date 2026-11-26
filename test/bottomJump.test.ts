import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  distanceFromBottom,
  HIDE_JUMP_BUTTON,
  nextJumpVisible,
  SHOW_JUMP_BUTTON,
} from '../src/components/messages/bottomJump.js'

const metrics = (scrollHeight: number, scrollTop: number, clientHeight: number) => ({
  scrollHeight,
  scrollTop,
  clientHeight,
})

test('离底部的距离就是剩下没滚到的那一截', () => {
  assert.equal(distanceFromBottom(metrics(2000, 1000, 800)), 200)
  assert.equal(distanceFromBottom(metrics(2000, 1200, 800)), 0)
})

test('内容比一屏还短、或者回弹算出负数，都按 0 算', () => {
  assert.equal(distanceFromBottom(metrics(500, 0, 800)), 0)
  assert.equal(distanceFromBottom(metrics(2000, 1300, 800)), 0)
})

test('远到超过上阈值才出现', () => {
  assert.equal(nextJumpVisible(false, SHOW_JUMP_BUTTON + 1), true)
  // 正好等于阈值不算"远"：`>` 而不是 `>=`
  assert.equal(nextJumpVisible(false, SHOW_JUMP_BUTTON), false)
  assert.equal(nextJumpVisible(false, 0), false)
})

test('回到下阈值以内才收起', () => {
  assert.equal(nextJumpVisible(true, HIDE_JUMP_BUTTON + 1), true)
  assert.equal(nextJumpVisible(true, HIDE_JUMP_BUTTON), false)
  assert.equal(nextJumpVisible(true, 0), false)
})

test('两个阈值之间保持原样——这就是它不闪的原因', () => {
  const between = (SHOW_JUMP_BUTTON + HIDE_JUMP_BUTTON) / 2
  assert.equal(nextJumpVisible(true, between), true)
  assert.equal(nextJumpVisible(false, between), false)
})

test('在临界点上反复微动不会来回翻', () => {
  // 一路往上滚：从底部开始，按钮依次经历「不显示 → 显示」，中间只有一次翻转
  let visible = false
  const flips: boolean[] = []
  for (let distance = 0; distance <= 300; distance += 2) {
    const next = nextJumpVisible(visible, distance)
    if (next !== visible) {
      flips.push(next)
    }
    visible = next
  }
  assert.deepEqual(flips, [true])

  // 再一路滚回底部：同样只有一次翻转
  for (let distance = 300; distance >= 0; distance -= 2) {
    const next = nextJumpVisible(visible, distance)
    if (next !== visible) {
      flips.push(next)
    }
    visible = next
  }
  assert.deepEqual(flips, [true, false])
})
