import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatBalance, parseBalanceSnapshot } from '../src/services/balance.js'

const body = (isAvailable: unknown) => ({
  ...(isAvailable === '__missing__' ? {} : { is_available: isAvailable }),
  balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }],
})

test('is_available 为真 → available', () => {
  assert.equal(parseBalanceSnapshot(body(true))?.availability, 'available')
})

test('is_available 为假 → unavailable', () => {
  assert.equal(parseBalanceSnapshot(body(false))?.availability, 'unavailable')
})

test('接口没给 is_available → missing（按不可用处理）', () => {
  assert.equal(parseBalanceSnapshot(body('__missing__'))?.availability, 'missing')
})

test('is_available 不是布尔 → invalid（界面显示 Unknown）', () => {
  assert.equal(parseBalanceSnapshot(body('true'))?.availability, 'invalid')
  assert.equal(parseBalanceSnapshot(body(1))?.availability, 'invalid')
})

test('没有币种余额的响应不算成功', () => {
  assert.equal(parseBalanceSnapshot({ is_available: true, balance_infos: [] }), null)
  assert.equal(parseBalanceSnapshot({ is_available: true }), null)
  assert.equal(parseBalanceSnapshot(null), null)
})

test('人民币带符号，其它币种把代码写在后面', () => {
  assert.equal(formatBalance({ currency: 'CNY', total: '12.34', granted: '', toppedUp: '' }), '¥12.34')
  assert.equal(formatBalance({ currency: 'USD', total: '1.00', granted: '', toppedUp: '' }), '$1.00')
  assert.equal(formatBalance({ currency: 'EUR', total: '1.00', granted: '', toppedUp: '' }), '1.00 EUR')
})
