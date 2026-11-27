import { create } from 'zustand'
import { sameTurnRows, type TurnRow } from './turnRows.js'

/**
 * MessageList → 右侧目录 的一座桥。
 *
 * 只有一个写入方（MessageList，它才拥有窗口状态与锚点补偿），抽屉只读、外加调两个动作。
 * 曾经考虑过让抽屉自己也记一份窗口起点，那样两边迟早会不同步——「展开更早」点了之后
 * 一个说还剩 5 轮、另一个说还剩 4 轮，用户没法判断哪个是真的。
 */

export type OlderCounts = { revealed: number; remaining: number }

export type TurnNavBridge = {
  sessionId: string | null
  rows: TurnRow[]
  /** 顶上那颗「展开更早的 N 轮（总共还有 M 轮）」的两个数 */
  older: OlderCounts
  /** 还有没挂载的轮 → 显示那颗按钮 */
  expandable: boolean
  /** 已经没有可挂载的轮、但上面还有被压缩的对话 → 显示灰字 */
  compactedAbove: boolean
  /** 当前读到的那一轮（提问的 id）；null 表示还没算出来 */
  activeTurnId: string | null
  expandOlder: () => void
  jumpToTurn: (id: string) => void
}

const EMPTY_ROWS: TurnRow[] = []
const ZERO_OLDER: OlderCounts = { revealed: 0, remaining: 0 }
const noop = () => {}

export const useTurnNav = create<TurnNavBridge>(() => ({
  sessionId: null,
  rows: EMPTY_ROWS,
  older: ZERO_OLDER,
  expandable: false,
  compactedAbove: false,
  activeTurnId: null,
  expandOlder: noop,
  jumpToTurn: noop,
}))

/**
 * 逐字段比对后再写。
 *
 * 流式输出时 MessageList 每帧都会重渲，`rows`/`older` 也会重新算一遍；直接 setState 会让
 * 抽屉跟着每帧重渲一次（里面可能有上百行）。内容没变就一个字节都不写。
 */
export const publishTurnNav = (next: {
  sessionId: string | null
  rows: TurnRow[]
  older: OlderCounts
  expandable: boolean
  compactedAbove: boolean
  expandOlder: () => void
  jumpToTurn: (id: string) => void
}) => {
  const current = useTurnNav.getState()
  const patch: Partial<TurnNavBridge> = {}
  if (current.sessionId !== next.sessionId) {
    patch.sessionId = next.sessionId
    // 换会话时当前轮一定换了，顺手清掉，别让新会话先高亮旧的一行
    patch.activeTurnId = null
  }
  if (!sameTurnRows(current.rows, next.rows)) {
    patch.rows = next.rows
  }
  if (current.older.revealed !== next.older.revealed || current.older.remaining !== next.older.remaining) {
    patch.older = next.older
  }
  if (current.expandable !== next.expandable) {
    patch.expandable = next.expandable
  }
  if (current.compactedAbove !== next.compactedAbove) {
    patch.compactedAbove = next.compactedAbove
  }
  if (current.expandOlder !== next.expandOlder) {
    patch.expandOlder = next.expandOlder
  }
  if (current.jumpToTurn !== next.jumpToTurn) {
    patch.jumpToTurn = next.jumpToTurn
  }
  if (Object.keys(patch).length > 0) {
    useTurnNav.setState(patch)
  }
}

/** 滚动时调用：值没变就返回，不惊动任何订阅者 */
export const setActiveTurn = (id: string | null) => {
  if (useTurnNav.getState().activeTurnId === id) {
    return
  }
  useTurnNav.setState({ activeTurnId: id })
}

/** 会话关掉（回到欢迎页）时清空，免得抽屉里留着上一段对话的目录 */
export const clearTurnNav = () => {
  const current = useTurnNav.getState()
  if (current.sessionId === null && current.rows === EMPTY_ROWS) {
    return
  }
  useTurnNav.setState({
    sessionId: null,
    rows: EMPTY_ROWS,
    older: ZERO_OLDER,
    expandable: false,
    compactedAbove: false,
    activeTurnId: null,
    expandOlder: noop,
    jumpToTurn: noop,
  })
}
