import { useEffect } from 'react'
import { isAttachPanelOpen } from '../components/chatInput/attachPanelState.js'
import { isCropping } from '../components/camera/cropState.js'
import { isInAppCameraOpen } from '../components/camera/inAppCameraState.js'
import { useFilePreview } from '../components/files/filePreviewState.js'
import { useSearchPanel } from '../components/search/searchPanelState.js'
import { useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { useMobileSider } from '../components/sider/mobileSiderState.js'

/** 起手点限制在左侧这个宽度内，避免在正文中间误触 */
const START_LIMIT = 160
const START_RATIO = 0.4
/** 横向位移超过它才算「右滑」 */
const TRIGGER_DISTANCE = 72
/** 起手后这么久还没判出方向，就当成长按选字之类的操作让出去 */
const DIRECTION_WINDOW = 400
/** 判方向的阈值 */
const SLOP = 12
/** 横向要明显压过纵向才认，斜着划是在滚列表 */
const HORIZONTAL_RATIO = 1.4

/** 有东西叠在会话上面时，边缘手势交给它自己处理 */
const overlayOpen = () =>
  isCropping() ||
  isInAppCameraOpen() ||
  isAttachPanelOpen() ||
  useFilePreview.getState().url !== null ||
  useSettingsDialog.getState().open ||
  useSearchPanel.getState().entry !== null ||
  useMobileSider.getState().open ||
  document.querySelector('[role="dialog"]') !== null

/** 起手点落在可横向滚动的内容里（代码块、宽表格）时，右滑留给它自己滚 */
const scrollsHorizontally = (target: Element) => {
  for (let element: Element | null = target; element && element !== document.body; ) {
    const style = getComputedStyle(element)
    if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth) {
      return true
    }
    element = element.parentElement
  }
  return false
}

/**
 * 移动端在左侧右滑打开侧边栏。
 * 只认「单指 + 从左侧起手 + 快速横划」：纵向滚动、斜着划、长按选字、点输入框、
 * 代码块横向滚动、有弹窗叠在上面时都不接管。
 */
export const useSiderSwipe = (enabled: boolean, onOpen: () => void) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let tracking = false
    let horizontal = false
    let startX = 0
    let startY = 0
    let startTime = 0

    const stop = () => {
      tracking = false
      horizontal = false
    }

    const onTouchStart = (event: TouchEvent) => {
      stop()
      if (event.touches.length !== 1) {
        return
      }
      if (overlayOpen()) {
        return
      }
      const touch = event.touches[0]
      if (touch.clientX > Math.min(START_LIMIT, window.innerWidth * START_RATIO)) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (!target) {
        return
      }
      if (target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      if (scrollsHorizontally(target)) {
        return
      }
      tracking = true
      startX = touch.clientX
      startY = touch.clientY
      startTime = event.timeStamp
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) {
        return
      }
      if (event.touches.length !== 1) {
        stop()
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!horizontal) {
        // 先判方向：纵向为主是在滚列表，向左是在做别的手势，都交出去
        if (Math.abs(dy) > SLOP && Math.abs(dy) * HORIZONTAL_RATIO >= Math.abs(dx)) {
          stop()
          return
        }
        if (dx < -SLOP) {
          stop()
          return
        }
        if (!(Math.abs(dx) > SLOP && Math.abs(dx) * HORIZONTAL_RATIO >= Math.abs(dy))) {
          return
        }
        // 半天才动起来的多半是长按选字后拖手柄，不抢
        if (event.timeStamp - startTime > DIRECTION_WINDOW) {
          stop()
          return
        }
        horizontal = true
      }
      // 认下这条手势后要压住页面滚动，否则抽屉还没开、界面先跟着晃
      if (event.cancelable) {
        event.preventDefault()
      }
      if (dx >= TRIGGER_DISTANCE) {
        stop()
        onOpen()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', stop, { passive: true })
    window.addEventListener('touchcancel', stop, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', stop)
      window.removeEventListener('touchcancel', stop)
    }
  }, [enabled, onOpen])
}
