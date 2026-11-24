import { Capacitor, registerPlugin } from '@capacitor/core'

interface SystemBarPlugin {
  setStatusBarColor(options: { color: string; lightIcons: boolean }): Promise<void>
  setAppTheme(options: { theme: 'light' | 'dark' }): Promise<void>
}

const SystemBar = registerPlugin<SystemBarPlugin>('SystemBar')

/**
 * 设置原生状态栏底色与图标明暗。
 * lightIcons 为 true 时用浅色图标（深色底），false 时用深色图标（浅色底）。
 * Capacitor 自带的 status-bar 插件在 Android 16 设备上不再改底色，因此走这个通道。
 */
export const setSystemStatusBar = (color: string, lightIcons: boolean): Promise<void> =>
  Capacitor.isNativePlatform()
    ? SystemBar.setStatusBarColor({ color, lightIcons })
    : Promise.resolve()

/**
 * 把应用内选的深浅色告诉原生，供**下一次启动**的启动画面使用。
 *
 * 光看网页的话，原生读不到这个选择，启动画面只能跟着系统走：
 * 「应用深色 + 系统浅色」就会先闪一屏浅色。失败不影响界面，吞掉即可。
 */
export const setNativeAppTheme = (theme: 'light' | 'dark'): Promise<void> =>
  Capacitor.isNativePlatform()
    ? SystemBar.setAppTheme({ theme }).catch(() => {})
    : Promise.resolve()
