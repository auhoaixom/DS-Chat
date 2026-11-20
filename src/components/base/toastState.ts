import { create } from 'zustand'
import type { LinkedMessage, TranslationKey } from '../../i18n/index.js'

/** 提示条右侧的可点操作（例如「撤销」）；点击后执行回调并收起提示 */
export type ToastAction = { key: TranslationKey; onClick: () => void }

/** 轻提示：同一时间只显示一条，新的替换旧的，到时自动消失；文案在渲染时按当前语言翻译 */
type ToastState = {
  id: number
  message: LinkedMessage | string | null
  action: ToastAction | null
}

export const useToast = create<ToastState>(() => ({ id: 0, message: null, action: null }))

const DURATION = 3000
/** 带链接或带操作时多留一些时间，方便点击 */
const LONG_DURATION = 5000
let timer = 0

export const showToast = (message: LinkedMessage | string, action?: ToastAction) => {
  window.clearTimeout(timer)
  useToast.setState((state) => ({ id: state.id + 1, message, action: action ?? null }))
  const duration =
    action || (typeof message !== 'string' && message.link) ? LONG_DURATION : DURATION
  timer = window.setTimeout(() => useToast.setState({ message: null, action: null }), duration)
}

/** 立刻收起当前提示（点击操作后调用） */
export const hideToast = () => {
  window.clearTimeout(timer)
  useToast.setState({ message: null, action: null })
}
