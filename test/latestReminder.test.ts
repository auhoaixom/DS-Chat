import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLatestReminder } from '../src/services/chat/latestReminder.js'

const at = (iso: string) => new Date(iso)

test('五项信息用逗号拼起来，顺序固定', () => {
  const reminder = createLatestReminder(
    { locale: 'zh-CN', location: null },
    at('2026-11-21T10:30:00')
  )
  const parts = reminder.split(',')
  assert.equal(parts.length, 5)
  assert.equal(parts[0], '2026-11-21', '日期用本地时区，不能按 UTC 跨日')
  assert.equal(parts[3], 'Web')
})

test('没有位置信息时那一项为空但占位保留', () => {
  const reminder = createLatestReminder(
    { locale: 'zh-CN', location: null },
    at('2026-11-21T00:10:00')
  )
  assert.equal(reminder.split(',')[2], '')
})

test('国内位置落到城市名，城市码认不出时退回省名', () => {
  const city = createLatestReminder(
    { locale: 'zh-CN', location: { region: 'CN', province: '110000', city: '110100' } },
    at('2026-11-21T10:30:00')
  )
  assert.equal(city.split(',')[2], '北京市')

  const provinceOnly = createLatestReminder(
    { locale: 'zh-CN', location: { region: 'CN', province: '110000', city: '999999' } },
    at('2026-11-21T10:30:00')
  )
  assert.equal(provinceOnly.split(',')[2], '北京市', '城市码查不到时退回省名，不能留空')
})

test('非中文界面下位置只到国家一级', () => {
  const en = createLatestReminder(
    { locale: 'en-US', location: { region: 'CN', province: '110000', city: '110100' } },
    at('2026-11-21T10:30:00')
  )
  // 不落到城市：英文下只给国家名
  assert.notEqual(en.split(',')[2], '北京市')
  assert.ok(en.split(',')[2].length > 0)
})

test('语言项取自全局设置，与传入的 locale 无关', () => {
  /**
   * 这一项走的是全局翻译表（`translate`），不是参数里的 locale。
   * 目前的调用方传的就是 `useSettings.getState()`，两者恰好一致；
   * 这条用例把真实契约钉下来，避免以后有人以为换个 locale 就能换掉它。
   */
  const zh = createLatestReminder({ locale: 'zh-CN', location: null }, at('2026-11-21T10:30:00'))
  const en = createLatestReminder({ locale: 'en-US', location: null }, at('2026-11-21T10:30:00'))
  assert.equal(zh.split(',')[4], en.split(',')[4])
})

test('月末最后一刻不跨到前一天', () => {
  const reminder = createLatestReminder(
    { locale: 'zh-CN', location: null },
    at('2026-12-01T00:05:00')
  )
  assert.equal(reminder.split(',')[0], '2026-12-01')
})
