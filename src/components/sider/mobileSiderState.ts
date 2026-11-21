import { create } from 'zustand'

/** 收敛动画时长（ms） */
const SETTLE_MS = 220
/** 遮罩最深不透明度 */
const MASK_ALPHA = 0.32

/** 移动端侧边栏抽屉：open 是最终归属，拖动过程中的位置不进 React */
export const useMobileSider = create<{ open: boolean }>(() => ({ open: false }))

let drawerNode: HTMLDivElement | null = null
let maskNode: HTMLDivElement | null = null
let drawerWidth = 0
/** 当前展开进度 0..1，拖动和动画都写它 */
let progress = 0
let settleFrame = 0

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/**
 * 收起时只关掉遮罩的点击（抽屉本身在屏幕外，收不到触摸，不用管）。
 * 千万不要在这里动 aria-hidden / inert：它们会让 Chromium 重建无障碍子树，
 * 在会话列表这种体量上实测是一次 400ms 的主线程长任务，收敛动画直接卡死。
 */
const setInteractive = (on: boolean) => {
  if (!maskNode) {
    return
  }
  maskNode.style.pointerEvents = on ? 'auto' : 'none'
}

/**
 * 每帧只写 transform 和 opacity，且只用合成器能直接搬的属性。
 * - 不用自定义属性 --sider-x：它会往下继承，每帧把整棵会话列表的样式重算一遍。
 * - 不用 CSS transition：Chrome 会在动画开始时预栅格化整层，实测一次 250ms 的尖峰。
 */
const paint = (value: number) => {
  const drawer = drawerNode
  const mask = maskNode
  if (!drawer || !mask) {
    return
  }
  progress = clamp(value)
  drawer.style.transform = `translate3d(${-drawerWidth * (1 - progress)}px, 0, 0)`
  mask.style.opacity = String(progress * MASK_ALPHA)
}

const stopSettle = () => {
  if (settleFrame) {
    cancelAnimationFrame(settleFrame)
    settleFrame = 0
  }
}

/** 松手后自己补间到目标位置，走的是和拖动同一套 paint */
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
export const getSiderWidth = () => (drawerWidth > 0 ? drawerWidth : 300)

/** 抽屉挂载后登记节点，并按当前开合状态直接摆好位置（不做动画） */
export const bindSiderNodes = (drawer: HTMLDivElement | null, mask: HTMLDivElement | null) => {
  drawerNode = drawer
  maskNode = mask
  if (!drawer || !mask) {
    return
  }
  stopSettle()
  drawerWidth = drawer.offsetWidth
  const open = useMobileSider.getState().open
  setInteractive(open)
  paint(open ? 1 : 0)
}

/** 视口宽度变了，抽屉宽度跟着变，重新量一次 */
export const measureSider = () => {
  if (!drawerNode) {
    return
  }
  drawerWidth = drawerNode.offsetWidth
  paint(progress)
}

/** 拖动中：progress 0 收起 → 1 展开，跟随手指 */
export const dragSider = (value: number) => {
  if (!drawerNode || !maskNode) {
    return
  }
  // 手一碰就接管，正在跑的收敛动画让位
  stopSettle()
  paint(value)
}

/** 松手或用按钮触发：补间到目标状态 */
export const settleSider = (open: boolean) => {
  if (!drawerNode || !maskNode) {
    useMobileSider.setState({ open })
    return
  }
  setInteractive(open)
  animateTo(open ? 1 : 0)
  useMobileSider.setState({ open })
}

export const openMobileSider = () => settleSider(true)

export const closeMobileSider = () => settleSider(false)
