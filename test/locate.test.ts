import assert from 'node:assert/strict'
import { test } from 'node:test'

import { distanceKm, locate, MAX_ACCURACY_M } from '../src/services/locate.js'
import { cityPoints } from '../src/services/locationPoints.js'

const at = (latitude: number, longitude: number, accuracy = 30) =>
  locate({ latitude, longitude, accuracy })

test('直辖市：落在市域内就填到市', () => {
  const beijing = at(39.9042, 116.4074)
  assert.equal(beijing.kind, 'ok')
  assert.deepEqual(
    beijing.kind === 'ok' ? [beijing.province, beijing.city] : null,
    ['110000', '110100']
  )

  const shanghai = at(31.2304, 121.4737)
  assert.equal(shanghai.kind === 'ok' ? shanghai.city : null, '310100')
})

test('普通省份：省和市都填上', () => {
  const guangzhou = at(23.1291, 113.2644)
  assert.equal(guangzhou.kind, 'ok')
  assert.deepEqual(
    guangzhou.kind === 'ok' ? [guangzhou.province, guangzhou.city] : null,
    ['440000', '440100']
  )
})

test('港澳：补的同名市级项会被填上', () => {
  const hongKong = at(22.3193, 114.1694)
  assert.deepEqual(
    hongKong.kind === 'ok' ? [hongKong.province, hongKong.city] : null,
    ['810000', '810100']
  )

  const macau = at(22.1987, 113.5439)
  assert.deepEqual(
    macau.kind === 'ok' ? [macau.province, macau.city] : null,
    ['820000', '820100']
  )
})

test('台湾只填省，不猜市', () => {
  const taipei = at(25.033, 121.5654)
  assert.equal(taipei.kind, 'ok')
  assert.equal(taipei.kind === 'ok' ? taipei.province : null, '710000')
  assert.equal(taipei.kind === 'ok' ? taipei.city : '', null)
})

test('精度差于 5 公里：拒绝写入并给出公里数', () => {
  const coarse = at(39.9042, 116.4074, MAX_ACCURACY_M + 1)
  assert.equal(coarse.kind, 'imprecise')
  assert.equal(coarse.kind === 'imprecise' ? coarse.km : 0, 5)

  const wayOff = at(39.9042, 116.4074, 45_000)
  assert.equal(wayOff.kind, 'imprecise')
  assert.equal(wayOff.kind === 'imprecise' ? wayOff.km : 0, 45)
})

test('刚好 5 公里还算可用', () => {
  assert.equal(at(39.9042, 116.4074, MAX_ACCURACY_M).kind, 'ok')
})

test('海外坐标：不硬凑一个国内城市', () => {
  assert.equal(at(35.6762, 139.6503).kind, 'unmatched')
  assert.equal(at(51.5074, -0.1278).kind, 'unmatched')
  assert.equal(at(0, 0).kind, 'unmatched')
})

test('每省自洽：站在这省的城市点上，就该被认成这省', () => {
  const wrong = []
  for (const [latitude, longitude, province, city] of cityPoints) {
    const result = locate({ latitude, longitude, accuracy: 10 })
    if (result.kind !== 'ok' || result.province !== province) {
      wrong.push(`${city} → ${result.kind === 'ok' ? result.province : result.kind}`)
    }
  }
  assert.deepEqual(wrong, [], '有城市点被认到了别的省，多半是坐标填错')
})

test('距离用大圆距离，跨半个中国的量级对得上', () => {
  const beijingToShanghai = distanceKm(
    { latitude: 39.9042, longitude: 116.4074 },
    { latitude: 31.2304, longitude: 121.4737 }
  )
  assert.ok(beijingToShanghai > 1000 && beijingToShanghai < 1200, `实际 ${beijingToShanghai}`)
})
