import { Capacitor, registerPlugin } from '@capacitor/core'
import { translate } from '../i18n/index.js'

/**
 * 生成期间的保活开关（前台服务）。
 *
 * 为什么需要：应用切到后台就变成缓存进程，Android 12 起会冻结它，网页里的流式读取
 * 跟着停 —— 用户切回来轻则报错，重则白等。保活让进程留在"用户可感知"级别，
 * 流式循环（它对 document.hidden 已经做了同步刷新）就能在后台跑完。
 *
 * 三条纪律：
 * 1. **永不抛错**。起不来、插件不存在、系统拒绝，全都静默吞掉；发消息不依赖它。
 * 2. **引用计数**。同一时刻可能有多条流（两个会话、或生成中的自动压缩），
 *    只起一次服务，最后一个释放才停。
 * 3. **非原生平台一律 no-op**。浏览器预览、桌面探针、单元测试的行为不变。
 */
type KeepAliveBridge = {
  start(options: { title: string; body: string }): Promise<{ started: boolean }>
  progress(options: { title: string; body: string }): Promise<void>
  stop(): Promise<void>
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ opened: boolean }>
}

/** 进度文案最多两秒更新一次；后台没有定时器可用，靠"数据到达"这个事件驱动 */
const PROGRESS_INTERVAL_MS = 2000

let bridge: KeepAliveBridge | null = null
let active = 0
let lastProgressAt = 0
/** 测试用：Node 里 Capacitor.isNativePlatform() 恒为 false，需要能把它掰成 true */
let forcedNative: boolean | null = null

const native = () => forcedNative ?? Capacitor.isNativePlatform()

const getBridge = (): KeepAliveBridge => {
  bridge ??= registerPlugin<KeepAliveBridge>('KeepAlive')
  return bridge
}

export const acquireKeepAlive = async (): Promise<void> => {
  active += 1
  if (active > 1 || !native()) {
    return
  }
  lastProgressAt = 0
  try {
    await getBridge().start({
      title: translate('keepAliveTitle'),
      body: translate('keepAliveBody'),
    })
  } catch {
    // 保活是加分项：起不来也不能影响发请求
  }
}

export const releaseKeepAlive = async (): Promise<void> => {
  active = Math.max(0, active - 1)
  if (active > 0 || !native()) {
    return
  }
  try {
    await getBridge().stop()
  } catch {
    // 停不下来也只会多一条通知，不能影响已经结束的回复
  }
}

/**
 * 报告已生成的字数，更新通知里的进度。
 *
 * 调用点必须放在"收到流事件"之后：隐藏页面里 Chromium 会把 setTimeout/setInterval
 * 节流到分钟级，只有数据到达是准时的，所以进度只能由数据驱动。
 */
export const reportKeepAliveProgress = (chars: number): void => {
  if (!native() || active === 0) {
    return
  }
  const now = Date.now()
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) {
    return
  }
  lastProgressAt = now
  void getBridge()
    .progress({
      title: translate('keepAliveTitle'),
      body: translate('keepAliveProgress', { count: chars }),
    })
    .catch(() => {})
}

/** 只给测试用：换掉桥、把计数清零 */
export const setKeepAliveBridgeForTest = (fake: KeepAliveBridge | null): void => {
  bridge = fake
  active = 0
  lastProgressAt = 0
}

/** 只给测试用：假装运行在原生平台上（Node 里永远是 false） */
export const setKeepAliveNativeForTest = (value: boolean | null): void => {
  forcedNative = value
}

/**
 * 系统是否已允许"忽略电池优化"（MIUI 里就是「省电策略 = 无限制」）。
 *
 * 为什么需要它：实测前台服务 + 唤醒锁都挡不住 MIUI `reason = screen off` 的冻结，
 * 只有这条豁免能救息屏那条路。设置里据此显示「已允许」或「去设置」。
 */
export const isBackgroundAllowed = async (): Promise<boolean> => {
  if (!native()) {
    return false
  }
  try {
    const { ignoring } = await getBridge().isIgnoringBatteryOptimizations()
    return ignoring
  } catch {
    return false
  }
}

/** 拉起系统/厂商的"允许后台运行"设置页；跳不出去也只是没跳转，不影响任何功能 */
export const requestBackgroundAllowed = async (): Promise<void> => {
  if (!native()) {
    return
  }
  try {
    await getBridge().requestIgnoreBatteryOptimizations()
  } catch {
    // 打不开系统设置页面而已，不用告诉用户
  }
}

/** 只给测试用：读当前引用计数 */
export const keepAliveCountForTest = (): number => active
