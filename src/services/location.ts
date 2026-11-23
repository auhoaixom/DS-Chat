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
