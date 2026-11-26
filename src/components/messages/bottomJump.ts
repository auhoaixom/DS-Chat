/**
 * 「一键回到底部」那颗按钮的显隐判断。
 *
 * 两条阈值而不是一条：远到一定程度才出现，近到一定程度才收起，中间保持现状。
 * 单阈值会让按钮在临界点上随着每一次微小滚动反复闪烁。
 */

/** 离底部超过这个距离就出现（比贴底跟随的 40 大得多：只离底部一点点时，那个按钮没有意义） */
export const SHOW_JUMP_BUTTON = 120
/** 回到这个距离以内就收起 */
export const HIDE_JUMP_BUTTON = 40

/** 已经滚到离底部还有多少像素；负数（回弹时的可能出现）一律按 0 算 */
export const distanceFromBottom = (metrics: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): number => Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)

/**
 * 下一次该不该显示。
 *
 * 滞回：当前已经显示时，只有回到 `HIDE` 以内才收起；当前没显示时，要退到
 * `SHOW` 以外才出现。所以临界点附近来回微动不会让按钮闪。
 */
export const nextJumpVisible = (visible: boolean, distance: number): boolean =>
  visible ? distance > HIDE_JUMP_BUTTON : distance > SHOW_JUMP_BUTTON
