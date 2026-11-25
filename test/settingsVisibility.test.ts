import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  setShowContextMeter,
  setShowMessageCost,
  useSettings,
} from '../src/services/settings.js'

/**
 * 两个显示开关的默认值与落盘形态。
 *
 * 默认必须是「开」：升级上来的用户本地没有这两个 key，界面得和升级前一样。
 * 落盘写字符串 'false'，读取用 `!== 'false'`——不这么写的话，
 * 一个存进去的空串或乱码就会把整个界面关掉。
 */
test('两个显示开关默认为开', () => {
  assert.equal(useSettings.getState().showContextMeter, true)
  assert.equal(useSettings.getState().showMessageCost, true)
})

test('关掉之后内存与本地存储都记着，再打开能回来', () => {
  setShowContextMeter(false)
  setShowMessageCost(false)
  assert.equal(useSettings.getState().showContextMeter, false)
  assert.equal(useSettings.getState().showMessageCost, false)
  assert.equal(localStorage.getItem('chat-demo:show-context-meter'), 'false')
  assert.equal(localStorage.getItem('chat-demo:show-message-cost'), 'false')

  setShowContextMeter(true)
  setShowMessageCost(true)
  assert.equal(useSettings.getState().showContextMeter, true)
  assert.equal(localStorage.getItem('chat-demo:show-context-meter'), 'true')
})
