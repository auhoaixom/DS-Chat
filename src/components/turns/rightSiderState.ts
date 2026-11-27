import { create } from 'zustand'
import { closeMobileSider, useMobileSider } from '../sider/mobileSiderState.js'

/**
 * 右侧目录抽屉的位置状态机——`mobileSiderState` 的镜像。
 *
 * 三条禁忌与左抽屉完全一致，改这里之前先读那份注释：
 * 不用自定义属性传位置（会往下继承、每帧重算整棵列表）、不用 CSS transition（预栅格化，
 * 实测 250ms 尖峰）、收起时不写 aria-hidden / inert（重建无障碍子树，实测 400ms 长任务）。
 */

/** 收敛动画时长（ms） */
const SETTLE_MS = 220
/** 遮罩最深不透明度 */
const MASK_ALPHA = 0.32

export const useRightSider = create<{ open: boolean }>(() => ({ open: false }))

let drawerNode: HTMLDivElement | null = null
let maskNode: HTMLDivElement | null = null
let drawerWidth = 0
/** 当前展开进度 0..1，拖动和动画都写它 */
let progress = 0
let settleFrame = 0

const clamp = (value: number) => Math.min(1, Math.max(0, value))

const setInteractive = (on: boolean) => {
  if (!maskNode) {
    return
  }
  maskNode.style.pointerEvents = on ? 'auto' : 'none'
}

const paint = (value: number) => {
  const drawer = drawerNode
  const mask = maskNode
  if (!drawer || !mask) {
    return
  }
  progress = clamp(value)
  // 收起时整块推到右边外面：进度 0 → 右移一整宽
  drawer.style.transform = `translate3d(${drawerWidth * (1 - progress)}px, 0, 0)`
  mask.style.opacity = String(progress * MASK_ALPHA)
}

const stopSettle = () => {
  if (settleFrame) {
    cancelAnimationFrame(settleFrame)
    settleFrame = 0
  }
}

const animateTo = (target: number) => {
  stopSettle()
  const from = progress
  const start = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / SETTLE_MS)
    const eased = 1 - (1 - t) ** 3
    paint(from + (target - from) * eased)
    settleFrame = t < 1 ? requestAnimationFrame(step) : 0
  }
  settleFrame = requestAnimationFrame(step)
}

/** 抽屉当前宽度（CSS px），手势用它把位移换算成进度 */
export const getRightSiderWidth = () => (drawerWidth > 0 ? drawerWidth : 300)

export const bindRightSiderNodes = (drawer: HTMLDivElement | null, mask: HTMLDivElement | null) => {
  drawerNode = drawer
  maskNode = mask
  if (!drawer || !mask) {
    return
  }
  stopSettle()
  drawerWidth = drawer.offsetWidth
  const open = useRightSider.getState().open
  setInteractive(open)
  paint(open ? 1 : 0)
}

export const measureRightSider = () => {
  if (!drawerNode) {
    return
  }
  drawerWidth = drawerNode.offsetWidth
  paint(progress)
}

export const dragRightSider = (value: number) => {
  if (!drawerNode || !maskNode) {
    return
  }
  stopSettle()
  paint(value)
}

export const settleRightSider = (open: boolean) => {
  if (!drawerNode || !maskNode) {
    useRightSider.setState({ open })
    return
  }
  setInteractive(open)
  animateTo(open ? 1 : 0)
  useRightSider.setState({ open })
}

/**
 * 开右抽屉时把左抽屉收掉。两个抽屉不会同时开着——遮罩叠一层没人说得清哪层该吃掉点击，
 * 而且一个手势状态机同时推两块会互相打脸。手势层已经保证了这一点，这里是兜底。
 */
export const openRightSider = () => {
  if (useMobileSider.getState().open) {
    closeMobileSider()
  }
  settleRightSider(true)
}

export const closeRightSider = () => settleRightSider(false)
