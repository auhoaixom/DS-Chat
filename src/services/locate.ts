/**
 * 把手机坐标落到「省 + 市」。
 *
 * 规则是"就近取城市，再用省份包围盒兜脏数据"：
 *
 * 1. 按大圆距离把所有城市点排序；
 * 2. 取最近的那个城市点，但要先确认它**落在自己省份的包围盒里**——不在就跳过，看下一个。
 * 3. 一个都过不了（坐标根本不在国内）→ `unmatched`。
 *
 * 为什么要有第 2 步：数据里曾把「铁门关市」的坐标填成重庆市中心，于是人在重庆会被
 * 匹配到新疆。包围盒能把这种点位筛掉，让匹配退回到真正合适的城市。
 *
 * 为什么不先选省份再选城市：试过用省级质心定省，394 个城市点里有 69 个会被判到
 * 邻省（廊坊 → 天津、承德 → 北京这种），因为质心对幅员大的省份毫无代表性。
 */

import { cityPoints } from './locationPoints.js'

/** 定位精度差于这个值（米）就不写地址 */
export const MAX_ACCURACY_M = 5000

/** 最近城市点距离超过这个值（度），认为坐标根本不在国内 */
export const MAX_MATCH_DEGREES = 2.5

/** 省份包围盒向外放宽的度数，容忍城市点分布在省界附近 */
const BBOX_MARGIN = 0.3

/** 台湾只填省不填市：城市多且名称特殊，猜错比留空更糟 */
const PROVINCE_ONLY = new Set(['710000'])

export type LocateResult =
  | { kind: 'ok'; province: string; city: string | null; km: number }
  | { kind: 'imprecise'; km: number }
  | { kind: 'unmatched' }

type Point = { latitude: number; longitude: number }

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/** 两点之间的大圆距离（公里） */
export const distanceKm = (a: Point, b: Point): number => {
  const earthRadius = 6371
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)))
}

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** 每个省的经纬度包围盒，用来判断"这个城市点是不是真的在自己省里" */
const provinceBounds = (() => {
  const bounds = new Map<string, Bounds>()
  for (const [latitude, longitude, province] of cityPoints) {
    const current = bounds.get(province)
    if (!current) {
      bounds.set(province, {
        minLat: latitude,
        maxLat: latitude,
        minLng: longitude,
        maxLng: longitude,
      })
      continue
    }
    current.minLat = Math.min(current.minLat, latitude)
    current.maxLat = Math.max(current.maxLat, latitude)
    current.minLng = Math.min(current.minLng, longitude)
    current.maxLng = Math.max(current.maxLng, longitude)
  }
  return bounds
})()

const insideProvince = (target: Point, province: string): boolean => {
  const bounds = provinceBounds.get(province)
  if (!bounds) {
    return false
  }
  return (
    target.latitude >= bounds.minLat - BBOX_MARGIN &&
    target.latitude <= bounds.maxLat + BBOX_MARGIN &&
    target.longitude >= bounds.minLng - BBOX_MARGIN &&
    target.longitude <= bounds.maxLng + BBOX_MARGIN
  )
}

const candidates = cityPoints.map(([latitude, longitude, province, city]) => ({
  province,
  city,
  point: { latitude, longitude },
}))

/** 与目标点在某一维上的最大差值（度），用来判断"离谱"而不是精确距离 */
const degreeGap = (a: Point, b: Point): number =>
  Math.max(Math.abs(a.latitude - b.latitude), Math.abs(a.longitude - b.longitude))

export const locate = ({
  latitude,
  longitude,
  accuracy,
}: Point & { accuracy: number }): LocateResult => {
  const target = { latitude, longitude }

  // 精度差就直接说，不做"大概猜一个"
  if (!Number.isFinite(accuracy) || accuracy > MAX_ACCURACY_M) {
    const km = Number.isFinite(accuracy) ? Math.round(accuracy / 1000) : 0
    return { kind: 'imprecise', km: Math.max(1, km) }
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, km: distanceKm(target, candidate.point) }))
    .sort((left, right) => left.km - right.km)

  for (const { candidate, km } of ranked) {
    if (!insideProvince(target, candidate.province)) {
      continue
    }
    if (degreeGap(target, candidate.point) > MAX_MATCH_DEGREES) {
      return { kind: 'unmatched' }
    }
    return {
      kind: 'ok',
      province: candidate.province,
      city: PROVINCE_ONLY.has(candidate.province) ? null : candidate.city,
      km: Math.round(km),
    }
  }

  return { kind: 'unmatched' }
}
