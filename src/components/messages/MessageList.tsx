import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { buildMessageVersions, getVisibleMessages, type MessageVersions } from '../../services/chat/branches.js'
import { getCoveredCount } from '../../services/chat/compaction.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { CompactionCard, CompactedOriginals } from './CompactionCard.js'
import { OLDER_CHUNK, LOAD_OLDER_THRESHOLD, clampWindowStart, initialWindowStart } from './messageWindow.js'
import { ChatScrollContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  /** 上一次渲染时的滚动位置与内容高度，用于抵消顶部插入/移除造成的位移 */
  const cutMetricsRef = useRef<{
    sessionId: string
    covered: number
    top: number
    height: number
  } | null>(null)
  const visible = getVisibleMessages(session)
  // 已经压进摘要的早期消息不再渲染，顶部改用一张压缩卡片表示
  const covered = getCoveredCount(visible, session.compaction)
  const messages = covered > 0 ? visible.slice(covered) : visible
  const coveredMessages = covered > 0 ? visible.slice(0, covered) : []
  /**
   * 只挂末尾一段消息；往上滚到顶再往前补。
   *
   * 记的是「从第几条开始」，不是「挂多少条」：来新消息（流式回复）时窗口不能跟着往前滑，
   * 否则正在往上翻旧消息的人会被顶一下。切会话时按当前条数重新算，而且是在渲染期间算的，
   * 不让下一段对话先按上一个会话的窗口挂一次。
   */
  const [windowState, setWindowState] = useState(() => ({
    sessionId: session.id,
    start: initialWindowStart(messages.length),
  }))
  // 起点收进合法范围；上界为什么是「留够一屏」而不是「最后一条」，见 messageWindow.ts
  const start = clampWindowStart(
    windowState.sessionId === session.id
      ? windowState.start
      : initialWindowStart(messages.length),
    messages.length,
  )
  const shown = start > 0 ? messages.slice(start) : messages
  /** 补载前记下的锚点元素与它当时的视口位置 */
  const olderAnchorRef = useRef<{ el: Element; top: number } | null>(null)
  /** 只读回看被覆盖的原文；与压缩状态无关，展开不影响请求 */
  const [originalsOpen, setOriginalsOpen] = useState(false)
  /** 展开原文那一刻的滚动位置与所属会话：收起时要回到这一屏（见下面的 useLayoutEffect） */
  const originalsOriginRef = useRef({ open: false, top: 0, sessionId: session.id })
  useEffect(() => {
    setOriginalsOpen(false)
  }, [session.id])
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  /**
   * 关掉贴底跟随，交给调用方在渲染后自己把元素位置补回来。
   *
   * 本来想在这里连补偿一起做，但**列表不会因为子树的状态变化而重渲染**
   * （思考窗口的展开是 ReplyArea 自己的 state），layout effect 跑不到。
   * 所以这里只负责最容易出错的那一半：`stickyRef`。
   */
  const holdAt = useCallback(() => {
    stickyRef.current = false
  }, [])
  const scrollApi = useMemo(() => ({ scrollToBottom, holdAt }), [scrollToBottom, holdAt])

  /**
   * 往前补一批更早的消息。
   *
   * 补偿**不能按 scrollHeight 差算**：消息上有 content-visibility，屏幕外的消息先按
   * contain-intrinsic-size 估高，滚进视口才换成真实高度，滚动高度会在补载的同一帧里
   * 被这批估值纠正（实测多算了 12.7 倍）。所以改记「某个元素当时在视口里的位置」，
   * 渲染后把它挪回原处——估值怎么变都不影响这条。
   */
  const loadOlder = useCallback(() => {
    const el = scrollRef.current
    const column = contentRef.current
    if (!el || !column || olderAnchorRef.current) {
      return
    }
    /**
     * 锚点必须取**第一条消息**，不能取 `column.children[0]`。
     *
     * 有压缩卡片时 children[0] 是卡片：它钉在列表最顶上（展开原文时还是 sticky），
     * 补一批旧消息它一动不动，算出来的补偿量恒为 0 —— 视口就会跟着往下跳，
     * 用户看到的是"我明明没动，画面却换了"。卡片恒为 1 个（有 compaction 就渲染），
     * 原文块在它下面，所以前面要跳过这么多个非消息子节点。
     */
    const lead = (session.compaction ? 1 : 0) + (originalsOpen ? 1 : 0)
    const anchor = column.children[lead]
    if (!anchor) {
      return
    }
    olderAnchorRef.current = { el: anchor, top: anchor.getBoundingClientRect().top }
    setWindowState((state) => ({
      sessionId: session.id,
      start: Math.max(
        0,
        (state.sessionId === session.id ? state.start : initialWindowStart(messages.length)) -
          OLDER_CHUNK,
      ),
    }))
  }, [originalsOpen, session.compaction, session.id, messages.length])

  // 补载之后的补偿必须在绘制前做完，所以放 useLayoutEffect
  useLayoutEffect(() => {
    const anchor = olderAnchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) {
      return
    }
    olderAnchorRef.current = null
    // 浏览器有时自己做滚动锚定；这时差值是 0，就不会重复补偿
    const delta = anchor.el.getBoundingClientRect().top - anchor.top
    if (delta !== 0) {
      el.scrollTop += delta
      scrollTopRef.current = el.scrollTop
    }
  }, [start])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  /**
   * 压缩或撤销压缩会一次性在列表顶部插入/移除一大段内容。
   * 只按滚动条位置保持的话，视口会被"顶"走（撤销时直接甩回对话开头），
   * 所以按内容高度差把滚动位置补回来，让用户眼前的那一条消息留在原处。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const previous = cutMetricsRef.current
    if (previous && previous.sessionId === session.id && previous.covered !== covered) {
      const delta = el.scrollHeight - previous.height
      // 本来就贴在顶部的用户想看的正是开头，这时不要把他往下推
      if (delta !== 0 && previous.top > 0) {
        el.scrollTop = Math.max(0, previous.top + delta)
        scrollTopRef.current = el.scrollTop
      }
    }
    cutMetricsRef.current = {
      sessionId: session.id,
      covered,
      top: el.scrollTop,
      height: el.scrollHeight,
    }
  }, [covered, isMobile, messages.length, session.id])

  /**
   * 收起原文时回到展开那一刻的那一屏。
   *
   * 原文块是插在卡片和消息之间的一大段内容：展开时它把下面的消息顶下去，正是要看的东西；
   * 收起时它整段被摘掉，而 `scrollTop` 不会跟着变小 —— 于是视口往下"漂"了正好那么多，
   * 眼前换成了对话后面的一段。用户的预期很直白：我点开时看到哪，收起时就该看到哪。
   *
   * 展开时记下 `scrollTop`，收起后还原。必须放在 useLayoutEffect 里（DOM 已经更新、
   * 还没绘制），否则会先闪一帧错误的位置。夹到合法范围，防止这期间内容变短后滚过头。
   *
   * 切会话时不算：那个场景有它自己的滚动规则（见上面两个 effect），这里插一脚会打架。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    const origin = originalsOriginRef.current
    const changed = origin.open !== originalsOpen
    origin.open = originalsOpen
    if (!el) {
      return
    }
    // 换对话不算：那个场景有自己的滚动规则（见上面两个 effect），这里插一脚会打架。
    // 但要把记录迁到新会话上，否则新会话里展开时记不下位置。
    if (origin.sessionId !== session.id) {
      origin.sessionId = session.id
      origin.top = el.scrollTop
      return
    }
    if (!changed) {
      return
    }
    if (originalsOpen) {
      origin.top = el.scrollTop
      return
    }
    el.scrollTop = Math.min(origin.top, Math.max(0, el.scrollHeight - el.clientHeight))
    scrollTopRef.current = el.scrollTop
    const metrics = cutMetricsRef.current
    if (metrics) {
      metrics.top = el.scrollTop
      metrics.height = el.scrollHeight
    }
  }, [originalsOpen, session.id])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      // 顶部内容变化时要靠这份基准把视口钉住，滚动后必须跟着更新，否则会用到过期位置
      const metrics = cutMetricsRef.current
      if (metrics) {
        metrics.top = el.scrollTop
        metrics.height = el.scrollHeight
      }
      // 滚到已挂内容的最上面，往前补一批。补完滚动位置会被补偿拉高，
      // 条件自然不再成立，不会连着触发。
      if (start > 0 && el.scrollHeight > el.clientHeight && el.scrollTop < LOAD_OLDER_THRESHOLD) {
        loadOlder()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom, start, loadOlder])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ChatScrollContext.Provider value={scrollApi}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            <CompactionCard
              sessionId={session.id}
              compaction={session.compaction}
              coveredCount={covered}
              originalsOpen={originalsOpen}
              onToggleOriginals={() => setOriginalsOpen((value) => !value)}
            />
            {originalsOpen ? <CompactedOriginals messages={coveredMessages} /> : null}
            {shown.map((message, offset) => {
              // 下标按整段消息算：窗口只影响挂多少，不影响"是不是第一条/最后一条"
              const index = start + offset
              return message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              ) : (
                <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              )
            })}
          </div>
        </div>
        {footer}
      </div>
    </ChatScrollContext.Provider>
  )
}
