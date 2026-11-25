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

const cny = (total: string): string => formatBalance({ currency: 'CNY', total, granted: '', toppedUp: '' })

test('余额的小数位跟着服务端走：给两位就两位，给更多就取四位', () => {
  assert.equal(cny('12.34'), '¥12.34')
  // 服务端给到八位（见过这种账号）时四舍五入到四位
  assert.equal(cny('13.39692526'), '¥13.3969')
  // 服务端自己写了四位就保持四位
  assert.equal(cny('13.4000'), '¥13.4000')
})

test('余额不足两位小数时补到分，不补到四位', () => {
  assert.equal(cny('13.4'), '¥13.40')
  assert.equal(cny('13'), '¥13.00')
})

test('余额解析不出来时原样透传，不改写拿到的数据', () => {
  assert.equal(cny('—'), '¥—')
  assert.equal(cny(''), '¥')
})
