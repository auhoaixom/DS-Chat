import { useEffect } from 'react'
import { isAttachPanelOpen } from '../components/chatInput/attachPanelState.js'
import { isCropping } from '../components/camera/cropState.js'
import { isInAppCameraOpen } from '../components/camera/inAppCameraState.js'
import { useFilePreview } from '../components/files/filePreviewState.js'
import { useSearchPanel } from '../components/search/searchPanelState.js'
import { useSettingsDialog } from '../components/settings/settingsDialogState.js'
import {
  dragSider,
  getSiderWidth,
  settleSider,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'

/**
 * 松手判定：从起手那一侧移动抽屉宽度的 0.18 就算数（300dp 抽屉约 54dp ≈ 0.86cm，
 * 所以按 0.9cm 划必然生效），两个方向共用同一个距离；或者甩得够快也换。
 */
const COMMIT_TRAVEL = 0.18
const FLING_VELOCITY = 0.35
/** 位移小于这个值一律回弹，免得指尖抖一下就切换 */
const MIN_TRAVEL = 32
/** 判方向的阈值，以及横向要明显压过纵向的倍数 */
const SLOP = 12
const HORIZONTAL_RATIO = 1.4

/** 有东西叠在会话上面时，边缘手势交给它自己处理（抽屉开着不算：那是反向关闭） */
const overlayOpen = () =>
  isCropping() ||
  isInAppCameraOpen() ||
  isAttachPanelOpen() ||
  useFilePreview.getState().url !== null ||
  useSettingsDialog.getState().open ||
  useSearchPanel.getState().entry !== null ||
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
 * 移动端侧边栏的拖动：收起时在左侧右滑拉出，展开时在屏幕**任意位置**左滑推回，
 * 全程跟随手指，松手按「位移过半或甩得够快」决定停在开还是关。
 * 纵向滚动、斜着划、长按选字、输入框、可横向滚动的内容、其它浮层都不接管。
 */
export const useSiderSwipe = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let tracking = false
    let horizontal = false
    let closing = false
    let startProgress = 0
    let startX = 0
    let startY = 0
    let startTime = 0
    let lastX = 0
    let lastTime = 0
    let velocity = 0
    let moved = false
    let suppressUntil = 0

    const stop = () => {
      tracking = false
      horizontal = false
    }

    const progressAt = (x: number) => startProgress + (x - startX) / Math.max(1, getSiderWidth())

    const onTouchStart = (event: TouchEvent) => {
      stop()
      if (event.touches.length !== 1 || overlayOpen()) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (!target) {
        return
      }
      const open = useMobileSider.getState().open
      closing = open
      if (open) {
        // 收起：屏幕任意位置起手都行，和展开对称（抽屉里、遮罩上都算）
        startProgress = 1
      } else {
        // 展开：也从屏幕任意位置起手，只要避开输入框和可横向滚动的内容
        if (target.closest('input, textarea, [contenteditable="true"]')) {
          return
        }
        if (scrollsHorizontally(target)) {
          return
        }
        startProgress = 0
      }
      const touch = event.touches[0]
      tracking = true
      moved = false
      startX = lastX = touch.clientX
      startY = touch.clientY
      startTime = lastTime = event.timeStamp
      velocity = 0
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
        // 先判方向：纵向为主是在滚列表，反方向是在做别的手势，都交出去
        if (Math.abs(dy) > SLOP && Math.abs(dy) * HORIZONTAL_RATIO >= Math.abs(dx)) {
          stop()
          return
        }
        // 收起状态下向左划是别的手势；展开时向左划正是要的关闭
        if (!closing && dx < -SLOP) {
          stop()
          return
        }
        if (!(Math.abs(dx) > SLOP && Math.abs(dx) * HORIZONTAL_RATIO >= Math.abs(dy))) {
          return
        }
        // 半天才动起来的多半是长按选字后拖手柄，不抢
        if (event.timeStamp - startTime > 400) {
          stop()
          return
        }
        horizontal = true
      }
      // 认下这条手势后要压住页面滚动，否则抽屉还没跟手、界面先跟着晃
      if (event.cancelable) {
        event.preventDefault()
      }
      const elapsed = event.timeStamp - lastTime
      if (elapsed > 0) {
        velocity = (touch.clientX - lastX) / elapsed
      }
      lastX = touch.clientX
      lastTime = event.timeStamp
      moved = true
      dragSider(progressAt(touch.clientX))
    }

    const onTouchEnd = () => {
      const wasTracking = tracking && horizontal
      stop()
      if (!wasTracking) {
        return
      }
      // 松手后紧跟着的那次点击不能算数，否则滑过会话行会顺手切走会话
      if (moved) {
        suppressUntil = performance.now() + 400
      }
      const dx = lastX - startX
      // 向右拖指向「展开」，向左拖指向「收起」；朝着当前状态的方向拖，保持不动
      const target = dx > 0
      const distanceOk = Math.abs(dx) >= getSiderWidth() * COMMIT_TRAVEL
      const flingOk = Math.abs(velocity) >= FLING_VELOCITY && velocity > 0 === dx > 0
      const open =
        Math.abs(dx) < MIN_TRAVEL || target === closing
          ? closing
          : distanceOk || flingOk
            ? target
            : closing
      settleSider(open)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() > suppressUntil) {
        return
      }
      suppressUntil = 0
      event.stopPropagation()
      event.preventDefault()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    document.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [enabled])
}
