import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPressMenu } from '../src/components/sider/pressMenu.js'

/**
 * 这一组钉的是 v1.0.0 在华为上的那个 bug：菜单一弹出来就消失。
 *
 * 原因不是「哪个事件没处理」，而是**用时间窗口判断同一次手势**：手指在菜单弹出后
 * 只要还按着超过 400ms，松手补发的 click 就不再被吞，于是走到「点这一行 = 收起菜单」
 * 把它关掉。这里没有时间参数，正是因为修复后的判断与时间无关。
 */

test('弹出菜单后，松手补发的 click 被吞掉——按多久都算同一次手势', () => {
  const press = createPressMenu()
  press.pressStart()
  press.opened()

  assert.equal(press.takeClick(), true)
  // 吞过之后就没了：再点一下是用户真的在点（用来收起菜单）
  assert.equal(press.takeClick(), false)
})

test('没弹出过菜单的那次按下：click 一次都不许吞', () => {
  const press = createPressMenu()
  press.pressStart()

  assert.equal(press.takeClick(), false)
})

test('上一次手势残留的待吞标记，会被下一次按下抹掉', () => {
  const press = createPressMenu()
  press.pressStart()
  press.opened()
  // 菜单弹出后有的 WebView 根本不补发 click，标记就一直挂着；
  // 下一次按下必须是干净的一次，不能把用户真的点击吞掉
  press.pressStart()

  assert.equal(press.takeClick(), false)
})
