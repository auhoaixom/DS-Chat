import type { Message } from '../../services/chat/types.js'

/**
 * 右侧「对话目录」的行数据与两处判定。
 *
 * 目录只覆盖**已经挂载的那一段消息**：它不自己分页，也不记窗口状态，
 * 窗口永远只有 MessageList 那一份。这样"展开更早"在两边是同一个动作，
 * 不会出现目录说还有 5 轮、消息那头说还有 4 轮的情况。
 */

export type TurnRowKind = 'text' | 'image' | 'file' | 'empty'

export type TurnRow = {
  /** 那一轮的第一条消息 id（提问本身），也是滚动定位的锚点 */
  id: string
  kind: TurnRowKind
  /** 提问正文；image / file / empty 这三类是空串，显示时换成占位文案 */
  text: string
}

/**
 * 一行 = 一轮 = 一条用户消息。回答不产出行，有没有回答也不影响这一行存不存在。
 *
 * 顺序原样（旧在前、新在后），与消息界面同向——用户打开抽屉时眼睛正落在某一段上，
 * 方向反了会看错轮。
 */
export const turnRows = (messages: readonly Message[]): TurnRow[] => {
  const rows: TurnRow[] = []
  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }
    const text = message.content.trim()
    if (text) {
      rows.push({ id: message.id, kind: 'text', text })
      continue
    }
    // 没有正文的提问：纯图片、纯附件、或者两者混着来
    const kind: TurnRowKind =
      message.files.length === 0
        ? 'empty'
        : message.files.every((file) => file.isImage)
          ? 'image'
          : 'file'
    rows.push({ id: message.id, kind, text: '' })
  }
  return rows
}

/** 唯一能区分两批行的东西；用于避免流式输出时把整棵目录重渲一遍 */
export const sameTurnRows = (left: readonly TurnRow[], right: readonly TurnRow[]) =>
  left === right ||
  (left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index].id && row.kind === right[index].kind && row.text === right[index].text
    ))

export type TurnRect = { id: string; top: number }

/**
 * 「现在读到哪一轮」：阅读线以上（`top <= line`）的最后一轮。
 *
 * 传进来的 rects 必须是 DOM 顺序（旧→新）。全都落在阅读线下方时返回 null，
 * 调用方自己决定要不要回退到第一行。
 */
export const activeTurnOf = (rects: readonly TurnRect[], line: number): string | null => {
  let current: string | null = null
  for (const rect of rects) {
    if (rect.top > line) {
      break
    }
    current = rect.id
  }
  return current
}

export type SwipeIntent = 'open-left' | 'close-left' | 'open-right' | 'close-right'

/**
 * 一次横滑该干什么。两个抽屉共用一个手势状态机，所以判定必须集中在这里：
 *
 * - 左抽屉开着：只认向左（关闭）；向右是别的手势；
 * - 右抽屉开着：只认向右（关闭）；向左是别的手势；
 * - 都关着：右滑开左、左滑开右。右抽屉不可用时（没有打开的对话）左滑直接不接手。
 */
export const swipeIntent = ({
  leftOpen,
  rightOpen,
  dx,
  rightEnabled,
}: {
  leftOpen: boolean
  rightOpen: boolean
  dx: number
  rightEnabled: boolean
}): SwipeIntent | null => {
  if (leftOpen) {
    return dx < 0 ? 'close-left' : null
  }
  if (rightOpen) {
    return dx > 0 ? 'close-right' : null
  }
  if (dx > 0) {
    return 'open-left'
  }
  return rightEnabled ? 'open-right' : null}
