import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  KEYBOARD_MIN_HEIGHT,
  keyboardHeight,
  keyboardVisible,
} from '../src/components/chatInput/keyboardViewport.js'

/** 没有键盘时的视口高度，也就是基线 */
const BASELINE = 1600
/** 键盘高度为 h 时的可视视口高度 */
const viewport = (keyboard: number) => BASELINE - keyboard

test('没有键盘时高度差为 0，判为不可见', () => {
  assert.equal(keyboardHeight(BASELINE, viewport(0)), 0)
  assert.equal(keyboardVisible(BASELINE, viewport(0)), false)
})

test('刚到一个键盘的最小高度就算可见', () => {
  assert.equal(keyboardVisible(BASELINE, viewport(KEYBOARD_MIN_HEIGHT)), true)
  assert.equal(keyboardVisible(BASELINE, viewport(KEYBOARD_MIN_HEIGHT - 1)), false)
})

test('视口比基线还高时不返回负数', () => {
  assert.equal(keyboardHeight(600, 900), 0)
})

test('键盘弹起过程中的抖动不会被判成"收起"', () => {
  // 一帧一帧模拟：视口从全高一路变矮，中间可能来回抖
  const frames = [1600, 1580, 1300, 1320, 1100, 1080, 1040]
  const seen = frames.map((height) => keyboardVisible(BASELINE, height))
  // 一旦可见就再也不该变回不可见（真正的收起不在这段里）
  const firstVisible = seen.indexOf(true)
  assert.ok(firstVisible >= 0, '键盘最终应当被判为可见')
  assert.ok(
    seen.slice(firstVisible).every(Boolean),
    `抖动的过程中出现了"不可见"：${seen.join(',')}`
  )
})

test('真正收起：视口从有键盘回到全高，可见性由真变假', () => {
  assert.equal(keyboardVisible(BASELINE, viewport(900)), true)
  assert.equal(keyboardVisible(BASELINE, viewport(0)), false)
})

test('重排模式下也成立：基线不变，视口跟着键盘一起缩', () => {
  // 重排时 vv.height 与布局同缩，基线仍是曾经的最大值
  assert.equal(keyboardVisible(BASELINE, 700), true)
  assert.equal(keyboardVisible(BASELINE, BASELINE), false)
})
