/**
 * 「查看原文」的手动分段。
 *
 * 原来这里是自动的：滚动到已渲染的末尾就补一批。问题是那个判定只看位置，不看用户
 * 是怎么到那儿的——一旦视口整块越过原文跑到很下面（点「回到底部」、拖滚动条、
 * 连续快速下拨），条件照样成立，于是会一路把几百条原文全部渲染出来，
 * 正好撞在分段要防的那件事上。
 *
 * 现在改成由用户的点击驱动：一次 5 轮，点一次多 5 轮。
 */

/** 一批几轮。轮 = 用户发过几条消息，回答不算（与消息列表同一口径） */
export const ORIGINALS_ROUNDS = 5

/**
 * 原文块末尾那颗哨兵还在滚动容器顶部之下 = 用户没滑过去，卡片继续吸顶。
 *
 * 只有一个边界：哨兵的底边正好压在容器顶边那一刻，算「还在里面」——
 * 用户贴着边界停住时不会看到卡片突然松开又贴回去。
 */
export const pinnedFromSentinel = (sentinelBottom: number, rootTop: number): boolean =>
  sentinelBottom >= rootTop

/**
 * 从 `from` 起往后取 `rounds` 轮，返回新的结束下标（不含）。
 *
 * 边界只落在提问上：收尾时会把最后那条提问的回复一并带上，用户不会看到
 * 「只有提问、没有回答」被切开的样子。
 *
 * 三种边角：
 * - `from` 落在助手回复上，说明这次要取的那一轮在更早的地方就开始了，先把它算作已开始，
 *   否则同一轮会被重复计算
 * - 一条提问都没有（极端数据）就直接给到底，不返回 `from` —— 那样按钮点了不会动
 * - `from` 已经到底就原样返回，调用方不会原地打转
 */
export const nextOriginalsEnd = (
  messages: readonly { role: string }[],
  from: number,
  rounds: number
): number => {
  const start = Math.max(0, Math.min(from, messages.length))
  if (start >= messages.length || rounds <= 0) {
    return start
  }
  let index = start
  let taken = messages[index].role === 'user' ? 0 : 1
  while (index < messages.length && taken < rounds) {
    if (messages[index].role === 'user') {
      taken += 1
    }
    index += 1
  }
  // 把最后那条提问的回复带完，别把一问一答切开
  while (index < messages.length && messages[index].role !== 'user') {
    index += 1
  }
  return index
}
