import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeLocation } from '../src/services/location.js'

/**
 * 下拉框里「不定位」对应的落点：
 * - 省选「不定位」→ 整条位置清空（`null`），市级下拉跟着回到「不定位」；
 * - 市选「不定位」→ 只清市，省保持原样。
 * 这两条由 `normalizeLocation` 的形状保证，所以在这里钉住。
 */
test('省选「不定位」：整条位置清空', () => {
  assert.equal(normalizeLocation(null), null)
  assert.equal(normalizeLocation(undefined), null)
})

test('市选「不定位」：省留下，市为空', () => {
  assert.deepEqual(normalizeLocation({ region: 'CN', province: '110000' }), {
    region: 'CN',
    province: '110000',
  })
})

test('省、市都选好时两级都在', () => {
  assert.deepEqual(normalizeLocation({ region: 'CN', province: '500000', city: '500100' }), {
    region: 'CN',
    province: '500000',
    city: '500100',
  })
})

test('海外只记国家，「不定位」同样清空', () => {
  assert.deepEqual(normalizeLocation({ region: 'JP' }), { region: 'JP' })
  assert.equal(normalizeLocation({ region: '' }), null)
})

test('认不出的省市码整条作废，不留下半条位置', () => {
  assert.equal(normalizeLocation({ region: 'CN', province: '999999' }), null)
  assert.equal(normalizeLocation({ region: 'CN', province: '110000', city: '999999' }), null)
})
