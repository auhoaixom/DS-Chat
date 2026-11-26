/**
 * 消息列表的分段挂载参数与窗口起点计算。
 *
 * 抽成纯函数是为了能被测试钉住：窗口起点算错时，界面会「只剩一条消息」，
 * 而这种缩水只在消息数大幅减少时才出现（压缩、切到更短的分支），
 * 靠手工去撞很难稳定复现。
 */

/** 首屏最多挂多少条消息 */
export const INITIAL_MESSAGES = 20
/**
 * 点一次「展开更早的 N 条」补多少条。
 *
 * 补载只由用户点击触发，所以这一批要够他一屏读完：20 条（正常对话约 10 轮）。
 * 以前是滚动到顶自动补 5 条，那套在长回复下等于每补一次就把人顶下去五屏。
 */
export const OLDER_CHUNK = 20
/** 距顶部小于该值算「贴着顶」：这里只用来决定那颗按钮该不该露面 */
export const LOAD_OLDER_THRESHOLD = 400

/** 新开一个会话时的起点：挂末尾一屏 */
export const initialWindowStart = (messageCount: number) =>
  Math.max(0, messageCount - INITIAL_MESSAGES)

/**
 * 把记下的窗口起点收进当前消息数的合法范围。
 *
 * 上界**必须**是 `messageCount - INITIAL_MESSAGES`，不是 `messageCount - 1`：
 * 可见消息变少时（压缩把早期消息压进摘要、切到条数更少的分支），起点还停在旧位置，
 * 按最后一条钳位会让整条对话只剩一条消息。上界取「留够一屏」则永远不会缩到一屏以下。
 */
export const clampWindowStart = (windowStart: number, messageCount: number) =>
  Math.min(windowStart, initialWindowStart(messageCount))

/**
 * 再往前展开一批之后的窗口起点。
 *
 * 落点必须落在**提问**上：往前补一批如果正好从头压在回答上，列表顶上就会出现一条
 * 没有提问的孤立回复。所以往前退到最近的提问，退到头就取 0。
 */
export const expandOlderStart = (
  messages: readonly { role: 'user' | 'assistant' }[],
  windowStart: number,
  chunk = OLDER_CHUNK,
) => {
  let next = Math.max(0, windowStart - chunk)
  while (next > 0 && messages[next]?.role !== 'user') {
    next -= 1
  }
  return next
}
