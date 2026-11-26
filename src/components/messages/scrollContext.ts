import { createContext, useContext } from 'react'

export type ChatScrollApi = {
  /** 渲染更新后请求滚到底部；用户上滑离开底部时由列表忽略 */
  scrollToBottom: () => void
  /**
   * 强制滑到底部并恢复贴底跟随。
   *
   * 与 `scrollToBottom` 的区别：那个会被"用户已经离开底部"挡掉（它是给流式内容用的），
   * 这个是用户主动按了「回到底部」，必须真的下去。带一小段动画，不是瞬移。
   */
  jumpToBottom: () => void
  /**
   * 把某个元素**钉在它当前的视口位置**：关掉贴底跟随，并在这次渲染后把滚动位置补回来。
   *
   * 用于"就地展开/收起"这类操作：展开会让下方内容一下子长高（或收起变矮），
   * 如果列表还在贴底跟随，视口会被拽到底部——用户点的是"展开"，不是"跳到最后"。
   */
  holdAt: (el: HTMLElement | null) => void
}

const noop = () => {}

export const ChatScrollContext = createContext<ChatScrollApi>({
  scrollToBottom: noop,
  jumpToBottom: noop,
  holdAt: noop,
})

export const useChatScroll = () => useContext(ChatScrollContext)
