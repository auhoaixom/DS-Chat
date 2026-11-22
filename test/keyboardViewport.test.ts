import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  KEYBOARD_HIDE_THRESHOLD,
  keyboardDismissed,
} from '../src/components/chatInput/keyboardViewport.js'

/**
 * 钉住"键盘被收起"的判据。
 *
 * 背景：键盘上的「收起」键只藏起 IME，不移动焦点，WebView 也不发事件。我们靠
 * visualViewport 高度变回来判断。阈值写错会带来两种真实故障：
 *   太小 → 工具栏轻微伸缩就被当成"收起"，正打字时输入框莫名失焦
 *   太大 → 小屏上键盘只涨了九十来像素，收起来了却检测不到，焦点留在输入框
 */

test('视口明显长高 = 键盘被收起', () => {
  assert.equal(keyboardDismissed(400, 720), true)
})

test('刚好到阈值就算收起（边界不能漏）', () => {
  assert.equal(keyboardDismissed(620, 620 + KEYBOARD_HIDE_THRESHOLD), true)
})

test('小于阈值的起伏不算收起', () => {
  assert.equal(keyboardDismissed(620, 620 + KEYBOARD_HIDE_THRESHOLD - 1), false)
})

test('键盘弹出（视口变矮）不算收起', () => {
  assert.equal(keyboardDismissed(720, 400), false)
})
