import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enterAction } from '../src/components/chatInput/enterAction.js'

const base = { key: 'Enter', shiftKey: false, composing: false }

test('默认（换行模式）：回车换行，不发送', () => {
  assert.equal(enterAction({ ...base, enterNewline: true }), 'newline')
})

test('切到发送模式：回车直接发送', () => {
  assert.equal(enterAction({ ...base, enterNewline: false }), 'send')
})

test('Shift + Enter 在任何模式下都是换行', () => {
  assert.equal(enterAction({ ...base, shiftKey: true, enterNewline: false }), 'newline')
  assert.equal(enterAction({ ...base, shiftKey: true, enterNewline: true }), 'newline')
})

test('输入法组字过程中的回车不拦截', () => {
  assert.equal(enterAction({ ...base, composing: true, enterNewline: false }), null)
  assert.equal(enterAction({ ...base, composing: true, enterNewline: true }), null)
})

test('其它按键不参与', () => {
  assert.equal(enterAction({ ...base, key: 'a', enterNewline: false }), null)
  assert.equal(enterAction({ ...base, key: 'NumpadEnter', enterNewline: false }), null)
})
