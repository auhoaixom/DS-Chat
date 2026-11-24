import { Capacitor, registerPlugin } from '@capacitor/core'

interface SplashPlugin {
  dismiss(options: { at: number }): Promise<void>
}

const Splash = registerPlugin<SplashPlugin>('Splash')

let dismissed = false

/**
 * 告诉原生「界面可以显示了」，由它撤掉启动画面。
 *
 * 调用时机由界面自己判断（会话列表读完、出现加密对话框、出现错误页），
 * 原生那边没有计时器 —— 所以 logo 停多久完全取决于加载多久，不是写死的数字。
 * 只在第一次生效：后面重复调用直接忽略。
 */
export const dismissSplash = (): void => {
  if (dismissed) {
    return
  }
  dismissed = true
  if (!Capacitor.isNativePlatform()) {
    return
  }
  // at 只用于日志对表：原生那边打的是同一把钟，可以量出「网页说好了 → 画面真的撤掉」的延迟
  void Splash.dismiss({ at: Date.now() }).catch(() => {})
}

/** 供测试重置「已经撤过」的标记 */
export const resetSplashForTest = (): void => {
  dismissed = false
}
