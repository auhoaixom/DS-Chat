import assert from 'node:assert/strict'
import { test } from 'node:test'

import { provinces } from '../src/services/location.js'
import { cityPoints } from '../src/services/locationPoints.js'

const provinceCodes = new Set(provinces.map((item) => item.code))
const cityCodes = new Set(provinces.flatMap((item) => item.cities.map((city) => city.code)))

test('每个城市点都指向真实存在的省与市', () => {
  const broken = cityPoints
    .filter(([, , province, city]) => !provinceCodes.has(province) || !cityCodes.has(city))
    .map(([, , province, city]) => `${province}/${city}`)
  assert.deepEqual(broken, [])
})

test('同一座城市只出现一次', () => {
  const codes = cityPoints.map(([, , , city]) => city)
  assert.equal(new Set(codes).size, codes.length)
})

test('坐标落在中国的包围盒内', () => {
  const outside = cityPoints
    .filter(([lat, lng]) => lat < 3 || lat > 54 || lng < 73 || lng > 136)
    .map(([lat, lng, , city]) => `${city} (${lat}, ${lng})`)
  assert.deepEqual(outside, [])
})

test('每个省级行政区至少有一个城市点', () => {
  const covered = new Set(cityPoints.map(([, , province]) => province))
  const missing = [...provinceCodes].filter((code) => !covered.has(code))
  assert.deepEqual(missing, [], '这些省没有任何城市点，定位永远落不进去')
})
