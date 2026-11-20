import { Capacitor, registerPlugin } from '@capacitor/core'

interface SystemBarPlugin {
  setStatusBarColor(options: { color: string; lightIcons: boolean }): Promise<void>
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
