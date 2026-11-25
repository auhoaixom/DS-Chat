import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'
import type { Locale } from './settings.js'

export { regionCodes } from './locationData.js'

export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

const regions = new Set(regionCodes)
/** 地区名各自的 Intl 实例；只有中英有手写覆盖，其余语言交给 Intl */
const displayNames = new Map<string, Intl.DisplayNames>()

const displayNamesFor = (locale: Locale): Intl.DisplayNames => {
  const cached = displayNames.get(locale)
  if (cached) {
    return cached
  }
  const created = new Intl.DisplayNames([locale], { type: 'region' })
  displayNames.set(locale, created)
  return created
}

const overrides = regionNameOverrides as Record<string, Record<string, string> | undefined>

export const getRegionName = (code: string, locale: Locale): string =>
  regions.has(code) ? (overrides[locale]?.[code] ?? displayNamesFor(locale).of(code) ?? code) : ''

/**
 * 位置在界面与提示里的写法：中文区写到市（没选市就写省），其它地区只写国家名。
 * 没选位置时返回空串，调用方自己决定这一项还留不留。
 */
export const locationDisplayName = (location: UserLocation | null, locale: Locale): string => {
  if (!location) {
    return ''
  }
  if (location.region === 'CN' && (locale === 'zh-CN' || locale === 'zh-TW')) {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    return city?.name ?? province?.name ?? getRegionName('CN', locale)
  }
  return getRegionName(location.region, locale)
}

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}
