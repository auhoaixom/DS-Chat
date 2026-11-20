import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { useSettings, type ThemePreference } from '../services/settings.js'
import { setSystemStatusBar } from '../services/systemBar.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

let appliedTheme: Theme | null = null

/** rgb()/rgba() 转 #rrggbb，原生状态栏只接受十六进制 */
const toHex = (color: string): string | null => {
  const parts = color.match(/\d+/g)
  if (!parts || parts.length < 3) {
    return null
  }
  const [red, green, blue] = parts.map(Number)
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** 原生容器里同步状态栏背景色与图标明暗；浏览器中跳过 */
const syncStatusBar = (theme: Theme, backgroundColor: string) => {
  if (!Capacitor.isNativePlatform()) {
    return
  }
  const lightIcons = theme === 'dark'
  const color = toHex(backgroundColor)
  if (color) {
    // 自带插件在 Android 16 上不会改底色，改用自建原生通道；失败时退回插件
    void setSystemStatusBar(color, lightIcons).catch(() => {
      void StatusBar.setBackgroundColor({ color }).catch(() => {})
    })
  }
  // Dark 表示深色背景配浅色图标，与页面主题一致
  void StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light }).catch(() => {})
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
  if (appliedTheme) {
    syncStatusBar(appliedTheme, backgroundColor)
  }
}

/** 同步页面主题、根画布背景、浏览器栏与原生状态栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}
