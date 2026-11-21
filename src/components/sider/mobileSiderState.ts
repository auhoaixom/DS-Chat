import { create } from 'zustand'

/** 收起/展开的过渡时长（ms），和 Sider.module.css 里的 transition 保持一致 */
const SETTLE_MS = 220
/** 遮罩最深不透明度 */
const MASK_ALPHA = 0.32

/** 移动端侧边栏抽屉：open 是最终归属，拖动过程中的位置不进 React */
export const useMobileSider = create<{ open: boolean }>(() => ({ open: false }))

let drawerNode: HTMLDivElement | null = null
let maskNode: HTMLDivElement | null = null
let drawerWidth = 0
let hideTimer: ReturnType<typeof setTimeout> | undefined

const clamp = (value: number) => Math.min(1, Math.max(0, value))

const clearHide = () => {
  clearTimeout(hideTimer)
  hideTimer = undefined
}

/**
 * 只写元素样式：拖动时每帧都走这里，不经过 React，
 * 否则会话列表每帧重算分组，卡顿会从松手挪到拖动中。
 */
const paint = (progress: number, animate: boolean) => {
  const drawer = drawerNode
  const mask = maskNode
  if (!drawer || !mask) {
    return
  }
  drawer.style.transition = animate ? '' : 'none'
  mask.style.transition = animate ? '' : 'none'
  drawer.style.setProperty('--sider-x', `${-drawerWidth * (1 - progress)}px`)
  mask.style.opacity = String(progress * MASK_ALPHA)
}

/** 抽屉节点：手势用它判断反向（关闭）拖动是否从抽屉上起手 */
export const getSiderDrawer = () => drawerNode

/** 抽屉当前宽度（CSS px），手势用它把位移换算成进度 */
export const getSiderWidth = () => (drawerWidth > 0 ? drawerWidth : 300)

/** 抽屉挂载后登记节点，并按当前开合状态直接摆好位置（不做动画） */
export const bindSiderNodes = (drawer: HTMLDivElement | null, mask: HTMLDivElement | null) => {
  clearHide()
  drawerNode = drawer
  maskNode = mask
  if (!drawer || !mask) {
    return
  }
  drawerWidth = drawer.offsetWidth
  const open = useMobileSider.getState().open
  drawer.style.visibility = open ? 'visible' : 'hidden'
  mask.style.pointerEvents = open ? 'auto' : 'none'
  drawer.style.opacity = ''
  paint(open ? 1 : 0, false)
}

/** 视口宽度变了，抽屉宽度跟着变，重新量一次 */
export const measureSider = () => {
  if (!drawerNode) {
    return
  }
  drawerWidth = drawerNode.offsetWidth
  paint(useMobileSider.getState().open ? 1 : 0, false)
}

/** 拖动中：progress 0 收起 → 1 展开，跟随手指 */
export const dragSider = (progress: number) => {
  const drawer = drawerNode
  const mask = maskNode
  if (!drawer || !mask) {
    return
  }
  clearHide()
  drawer.style.visibility = 'visible'
  mask.style.pointerEvents = 'auto'
  paint(clamp(progress), false)
}

/** 松手或用按钮触发：带动画收敛到目标状态 */
export const settleSider = (open: boolean) => {
  const drawer = drawerNode
  const mask = maskNode
  if (!drawer || !mask) {
    useMobileSider.setState({ open })
    return
  }
  clearHide()
  drawer.style.visibility = 'visible'
  mask.style.pointerEvents = open ? 'auto' : 'none'
  paint(open ? 1 : 0, true)
  useMobileSider.setState({ open })
  if (open) {
    return
  }
  // 滑完再藏起来，否则收起动画会被 visibility 直接掐断
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    if (!useMobileSider.getState().open && drawerNode) {
      drawerNode.style.visibility = 'hidden'
    }
  }, SETTLE_MS)
}

export const openMobileSider = () => settleSider(true)

export const closeMobileSider = () => settleSider(false)
