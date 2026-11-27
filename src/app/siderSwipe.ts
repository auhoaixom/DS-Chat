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
import {
  dragRightSider,
  getRightSiderWidth,
  settleRightSider,
  useRightSider,
} from '../components/turns/rightSiderState.js'
import { swipeIntent } from '../components/turns/turnRows.js'

/**
 * 松手判定：从起手那一侧移动抽屉宽度的 0.15 就算数（300dp 抽屉约 45dp ≈ 0.71cm），
 * 两个方向共用同一个距离；或者甩得够快也换。
 */
const COMMIT_TRAVEL = 0.15
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
  // 会话行菜单开着时不接管横滑，否则会连菜单带抽屉一起动
  document.querySelector('[role="menu"]') !== null ||
  document.querySelector('[role="dialog"]') !== null

/** 起手点落在可横向滚动的内容里（代码块、宽表格）时，横滑留给它自己滚 */
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

type Side = 'left' | 'right'

/**
 * 两个侧栏共用的横滑手势：**一个 hook、一套监听**。
 *
 * 左抽屉：收起时右滑拉出，展开时任意位置左滑推回。
 * 右目录：镜像——收起时左滑拉出，展开时右滑推回。
 *
 * 谁该动由 `swipeIntent` 判定（纯函数，有单测）：左开只认向左，右开只认向右，
 * 都关时右滑开左、左滑开右；右抽屉不可用时（没有打开的对话）左滑不接手。
 * 全程跟随手指，松手按「位移过半或甩得够快」决定停在开还是关。
 * 纵向滚动、斜着划、长按选字、输入框、可横向滚动的内容、其它浮层都不接管。
 */
export const useSiderSwipe = (leftEnabled: boolean, rightEnabled: boolean) => {
  useEffect(() => {
    if (!leftEnabled && !rightEnabled) {
      return
    }
    let tracking = false
    let horizontal = false
    /** 本次手势操作的是哪一侧；起手时已开着的那侧已知，都关时等方向定下来才知道 */
    let side: Side | null = null
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
      side = null
    }

    const widthOf = (target: Side) => (target === 'left' ? getSiderWidth() : getRightSiderWidth())

    /** 位移换算成进度：左抽屉向右为正，右抽屉向左为正 */
    const progressAt = (target: Side, x: number) => {
      const travel = target === 'right' ? startX - x : x - startX
      return startProgress + travel / Math.max(1, widthOf(target))
    }

    const dragOf = (target: Side, value: number) =>
      target === 'left' ? dragSider(value) : dragRightSider(value)

    const settleOf = (target: Side, open: boolean) =>
      target === 'left' ? settleSider(open) : settleRightSider(open)

    const onTouchStart = (event: TouchEvent) => {
      stop()
      if (event.touches.length !== 1 || overlayOpen()) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (!target) {
        return
      }
      const leftOpen = useMobileSider.getState().open
      const rightOpen = useRightSider.getState().open
      if (leftOpen) {
        // 收起：屏幕任意位置起手都行
        side = 'left'
        closing = true
        startProgress = 1
      } else if (rightOpen) {
        side = 'right'
        closing = true
        startProgress = 1
      } else {
        // 展开：也从屏幕任意位置起手，只要避开输入框和可横向滚动的内容
        if (target.closest('input, textarea, [contenteditable="true"]')) {
          return
        }
        if (scrollsHorizontally(target)) {
          return
        }
        side = null
        closing = false
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
        if (!(Math.abs(dx) > SLOP && Math.abs(dx) * HORIZONTAL_RATIO >= Math.abs(dy))) {
          return
        }
        // 方向 + 当前开合状态交给纯函数判定：交给谁、还是干脆不接手
        const intent = swipeIntent({
          leftOpen: closing && side === 'left',
          rightOpen: closing && side === 'right',
          dx,
          rightEnabled,
        })
        if (intent === null) {
          stop()
          return
        }
        if (!closing) {
          side = intent === 'open-left' ? 'left' : 'right'
        }
        // 半天才动起来的多半是长按选字后拖手柄，不抢
        if (event.timeStamp - startTime > 400) {
          stop()
          return
        }
        horizontal = true
      }
      if (side === null) {
        stop()
        return
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
      dragOf(side, progressAt(side, touch.clientX))
    }

    const onTouchEnd = () => {
      const wasTracking = tracking && horizontal && side !== null
      const activeSide = side
      stop()
      if (!wasTracking || activeSide === null) {
        return
      }
      // 松手后紧跟着的那次点击不能算数，否则滑过一行会顺手点进去
      if (moved) {
        suppressUntil = performance.now() + 400
      }
      const dx = lastX - startX
      // 朝「展开」方向拖才算展开：左抽屉向右、右抽屉向左
      const wantsOpen = activeSide === 'right' ? dx < 0 : dx > 0
      const distanceOk = Math.abs(dx) >= widthOf(activeSide) * COMMIT_TRAVEL
      const flingOk = Math.abs(velocity) >= FLING_VELOCITY && velocity > 0 === wantsOpen
      const open =
        Math.abs(dx) < MIN_TRAVEL || wantsOpen === closing
          ? closing
          : distanceOk || flingOk
            ? wantsOpen
            : closing
      settleOf(activeSide, open)
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
  }, [leftEnabled, rightEnabled])
}
