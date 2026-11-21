/**
 * 消息列表的分段挂载参数与窗口起点计算。
 *
 * 抽成纯函数是为了能被测试钉住：窗口起点算错时，界面会「只剩一条消息」，
 * 而这种缩水只在消息数大幅减少时才出现（压缩、切到更短的分支），
 * 靠手工去撞很难稳定复现。
 */

/** 首屏最多挂多少条消息 */
export const INITIAL_MESSAGES = 20
/** 往上滚到顶时一次补多少条 */
export const OLDER_CHUNK = 5
/** 滚到离顶部这么近就补下一批 */
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
