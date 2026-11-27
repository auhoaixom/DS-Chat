/**
 * 消息列表的分段挂载参数与窗口起点计算。
 *
 * 计价单位是**轮**，不是消息条数：用户发过几条消息就是几轮，回答不算。
 * 所以这里一律按「当前可见路径上的 user 消息」数点位，不假设一问一答两条并排——
 * 只有提问、还没回答的那一轮也是一轮；一条提问挂了好几个回答版本，仍然只算一轮。
 *
 * 抽成纯函数是为了能被测试钉住：窗口起点算错时，界面会「只剩一条消息」，
 * 而这种缩水只在消息数大幅减少时才出现（压缩、切到更短的分支），
 * 靠手工去撞很难稳定复现。
 */

/** 首屏最多显示多少轮 */
export const INITIAL_TURNS = 10
/**
 * 点一次「展开更早的 N 轮」补多少轮。
 *
 * 补载只由用户点击触发，所以这一批要够他一屏读完：10 轮（正常对话约 20 条）。
 * 以前是滚动到顶自动补 5 条，那套在长回复下等于每补一次就把人顶下去五屏。
 */
export const OLDER_TURNS = 10
/** 距顶部小于该值算「贴着顶」：这里只用来决定那颗按钮该不该露面 */
export const LOAD_OLDER_THRESHOLD = 400

type Row = { role: 'user' | 'assistant' }

const isTurnStart = (message: Row | undefined) => message?.role === 'user'

/** `[from, to)` 这段里有几轮 */
export const countTurns = (messages: readonly Row[], from: number, to: number) => {
  let count = 0
  for (let index = Math.max(0, from); index < Math.min(messages.length, to); index += 1) {
    if (isTurnStart(messages[index])) {
      count += 1
    }
  }
  return count
}

/**
 * 从末尾往前数第 `turns` 条提问的下标；不够 `turns` 轮就直接取 0。
 *
 * 返回的下标一定落在**提问**上，界面因此不会从一条没有提问的孤立回复开始。
 * 不够时取 0 而不是负数，意义是「全都挂上」。
 */
export const turnWindowStart = (messages: readonly Row[], turns: number) => {
  let seen = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isTurnStart(messages[index])) {
      seen += 1
      if (seen >= turns) {
        return index
      }
    }
  }
  return 0
}

/** 新开一个会话时的起点：挂末尾十轮 */
export const initialWindowStart = (messages: readonly Row[]) =>
  turnWindowStart(messages, INITIAL_TURNS)

/**
 * 把记下的窗口起点收进当前消息数的合法范围。
 *
 * 上界**必须**是「留够十轮」的那个下标，不是 `messages.length - 1`：
 * 可见消息变少时（压缩把早期消息压进摘要、切到条数更少的分支），起点还停在旧位置，
 * 按最后一条钳位会让整条对话只剩一条消息。上界取「留够十轮」则永远不会缩到一屏以下。
 */
export const clampWindowStart = (windowStart: number, messages: readonly Row[]) =>
  Math.min(windowStart, initialWindowStart(messages))

/**
 * 再往前展开一批之后的窗口起点。
 *
 * 从当前起点往前数 `turns` 条提问，落在最早那一条上；不够就取 0（一路挂到头）。
 */
export const expandOlderStart = (
  messages: readonly Row[],
  windowStart: number,
  turns = OLDER_TURNS,
) => {
  let seen = 0
  for (let index = windowStart - 1; index >= 0; index -= 1) {
    if (isTurnStart(messages[index])) {
      seen += 1
      if (seen >= turns) {
        return index
      }
    }
  }
  return 0
}

/**
 * 「压缩」相关的东西该不该在顶端露面——压缩卡片、以及右侧目录顶上那句灰字。
 *
 * 两个条件都得成立：窗口已经展到头（`start === 0`，再往上没有能挂载的轮了），
 * 而且上面**确实**压着一段被摘要覆盖的对话（`covered > 0`）。
 *
 * 只看"有压缩记录"是不够的：覆盖段被判无效时（导入的脏数据、路径对不上）摘要并不生效，
 * 那时候说"压缩过的对话不支持定位"、或者摆一张"已压缩"的卡片，都是在骗人。
 *
 * 这条规则以前只在右侧目录里守着，消息界面那张卡片是无条件渲染的——于是 128 轮的会话上
 * 出现了"卡片说再往上只剩摘要、紧下面那颗按钮说还有 88 轮没展开"的自相矛盾。
 * 现在两边共用这一条：**没展到头，就当压缩不存在**。
 */
export const compactedAtTop = (start: number, covered: number) => start === 0 && covered > 0

/**
 * 那颗蓝字按钮要说的三个数：新起点、这次会展开几轮、总共还压着几轮。
 *
 * 一次算清，免得按钮文案和实际展开的轮数各算各的——两者一旦不同，
 * 用户会看到「展开更早的 10 轮」点下去只多出 9 轮。
 */
export const olderTurnCounts = (
  messages: readonly Row[],
  windowStart: number,
  turns = OLDER_TURNS,
) => {
  const next = expandOlderStart(messages, windowStart, turns)
  return {
    next,
    revealed: countTurns(messages, next, windowStart),
    remaining: countTurns(messages, 0, windowStart),
  }
}
