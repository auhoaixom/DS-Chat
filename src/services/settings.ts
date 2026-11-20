import { create } from 'zustand'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、模型名、语言、主题、位置、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** 模型调用名；首次安装用 DEFAULT_MODEL，之后完全以用户填的为准 */
  model: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

/**
 * 首次安装时的模型名。官方改名时用户可以在设置里直接改，不必等新版本——
 * 所以这里只当作初值，不是"唯一可用的模型"。
 */
export const DEFAULT_MODEL = 'deepseek-flash'

/**
 * 1Mi：deepseek-flash（DeepSeek-V4.1-Flash）官方 /models 声明的窗口。
 * 窗口一律以模型自己声明的为准，认不出的模型才退回这个值——不接受用户调，界面上的
 * 「上限」因此永远是模型的事实，而不是某个人选的数字。
 */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576

const KEYS = {
  apiKey: 'chat-demo:api-key',
  model: 'chat-demo:model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  model: read(KEYS.model)?.trim() || DEFAULT_MODEL,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

/** 模型名由用户在设置里填、由 /models 校验后才调用这里 */
export const setModel = (model: string) => {
  const trimmed = model.trim()
  write(KEYS.model, trimmed)
  useSettings.setState({ model: trimmed || DEFAULT_MODEL })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
