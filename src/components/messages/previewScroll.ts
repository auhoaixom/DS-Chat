/**
 * 思考小窗的跟随滚动。
 *
 * 小窗不是滚动容器（用户不能在里面滑），内容位移由这里算：
 * 每帧朝「内容高 - 窗口高」追进一部分，追不上就一直追 —— 于是画面是**连续**往上走的，
 * 而不是攒够一行再"跳"一下。滞后量随内容增长速度变化，所以上下边缘会切在字中间，
 * 那是这个效果的正常表现，不是缺陷。
 *
 * 抽成纯函数是为了能单测：单调性、不过冲、吸附、以及"落后太多时直接跳"这几条
 * 在 DOM 里没法稳定断言。
 */

/** 每帧追进剩余距离的比例；60fps 下约 0.1 秒追平 */
export const PREVIEW_FOLLOW = 0.2
/** 离目标不到这么多像素就吸附，避免永远差一点、每帧重绘 */
export const PREVIEW_SNAP_GAP = 1
/** 落后超过这么多个窗口高就直接跳过去：一次进来一大段内容时，不要拉一条长长的追赶动画 */
export const PREVIEW_SNAP_RATIO = 3

export type PreviewScrollInput = {
  /** 当前位移（向下为正） */
  current: number
  /** 目标位移 = 内容高 - 窗口高，调用方夹到 ≥ 0 */
  target: number
  /** 窗口高度，用来判断"落后太多" */
  windowHeight: number
  /** 系统要求减少动效时一步到位 */
  reducedMotion?: boolean
}

/** 下一帧应该处在的位移；返回值永远是 current 与 target 之间的点（不过冲） */
export const nextOffset = ({
  current,
  target,
  windowHeight,
  reducedMotion = false,
}: PreviewScrollInput): number => {
  if (reducedMotion || target - current > windowHeight * PREVIEW_SNAP_RATIO) {
    return target
  }
  const next = current + (target - current) * PREVIEW_FOLLOW
  return Math.abs(target - next) <= PREVIEW_SNAP_GAP ? target : next
}
