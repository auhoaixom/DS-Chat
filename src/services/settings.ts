import { create } from 'zustand'
import { isSealedText, openText, sealText } from './crypto/seal.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ru-RU' | 'fr-FR'

/** 界面语言列表，顺序即设置里的顺序；名字用各语言自己的写法，不随界面语言翻译 */
export const LOCALES: { value: Locale; label: string; lang: string }[] = [
  { value: 'zh-CN', label: '简体中文', lang: 'zh-CN' },
  { value: 'zh-TW', label: '繁體中文', lang: 'zh-TW' },
  { value: 'en-US', label: 'English', lang: 'en' },
  { value: 'ja-JP', label: '日本語', lang: 'ja' },
  { value: 'ru-RU', label: 'Русский', lang: 'ru' },
  { value: 'fr-FR', label: 'Français', lang: 'fr' },
]

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
  /** 手机回车键的行为：true = 换行（默认），false = 直接发送 */
  enterNewline: boolean
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
  enterNewline: 'chat-demo:enter-newline',
} as const

const rawRead = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const read = (key: string) => {
  const value = rawRead(key)
  // API Key 是加密落盘的。还没解锁时读出来的是密文，这时要当作「还没填」——
  // 绝不能把密文原样塞进 Authorization 头发出去。
  if (key === KEYS.apiKey && isSealedText(value)) {
    return null
  }
  return value
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

const reportSettingsError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[settings] ${action} failed`, error)
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  const known = LOCALES.find((item) => item.value === saved)
  if (known) {
    return known.value
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
  // 没有存过就按换行：手机上回车直接发送太容易误触
  enterNewline: read(KEYS.enterNewline) !== 'false',
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

/**
 * API Key 的落盘形态是密文，而解密是异步的——zustand 的初始值却必须同步拿到。
 * 所以启动时先按「没有」渲染，由 boot 阶段调 unlockApiKey 把明文补进内存。
 * 那段时间界面被加密遮罩挡住，用户不会看到空 Key 闪一下。
 *
 * 其余设置（模型名、语言、主题、位置、开关）**不加密**：它们不是敏感内容，
 * 加密只会把整个设置模块变成异步，换不来任何东西。
 */
let unlocking: Promise<void> | null = null

const persistApiKey = async (apiKey: string | null): Promise<void> => {
  write(KEYS.apiKey, apiKey === null ? null : await sealText(apiKey, KEYS.apiKey))
}

const doUnlockApiKey = async (): Promise<void> => {
  const raw = rawRead(KEYS.apiKey)
  if (raw === null) {
    return
  }
  try {
    const plain = isSealedText(raw) ? await openText(raw, KEYS.apiKey) : raw
    useSettings.setState({ apiKey: plain })
    // 迁移前留下的明文值顺手加密写回：设置项里只有这一处需要迁移。
    if (!isSealedText(raw) && raw !== '') {
      await persistApiKey(raw)
    }
  } catch (error) {
    // 解不开（密钥换了，或记录坏了）：密文保留不删，内存置空让用户重新填。
    // 把密文当明文交给请求是更坏的结果。
    useSettings.setState({ apiKey: null })
    reportSettingsError('unlock api key')(error)
  }
}

/** 由 boot 调用一次；失败时清掉缓存，允许重试 */
export const unlockApiKey = (): Promise<void> =>
  (unlocking ??= doUnlockApiKey().catch((error: unknown) => {
    unlocking = null
    throw error
  }))

/** 只在测试里用：重置解锁状态 */
export const resetApiKeyUnlockForTest = () => {
  unlocking = null
}

export const setApiKey = (apiKey: string | null) => {
  useSettings.setState({ apiKey })
  // 内存里立刻是明文，磁盘上异步加密；这里不等它，界面不该为一个写盘抖动一下。
  void persistApiKey(apiKey).catch(reportSettingsError('save api key'))
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

export const setEnterNewline = (enterNewline: boolean) => {
  write(KEYS.enterNewline, String(enterNewline))
  useSettings.setState({ enterNewline })
}
