import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { buildMessageVersions, getVisibleMessages, type MessageVersions } from '../../services/chat/branches.js'
import { getCoveredCount } from '../../services/chat/compaction.js'
import { selectMessageVersion, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { CompactionCard, CompactedOriginals } from './CompactionCard.js'
import {
  OLDER_CHUNK,
  LOAD_OLDER_THRESHOLD,
  clampWindowStart,
  expandOlderStart,
  initialWindowStart,
} from './messageWindow.js'
import { messageKey } from './messageKeys.js'
import { distanceFromBottom, nextJumpVisible } from './bottomJump.js'
import { useFarFromBottom, setFarFromBottom } from './bottomJumpState.js'
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
const STICKY_THRESHOLD = 40/** 「回到底部」那段滑动的时长：再长像卡住，再短看不出是往下走 */
const JUMP_DURATION_MS = 280
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
  const t = useTranslate()
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
  /**
   * 压缩进行中同样算"忙"：那十几秒里覆盖段的边界还在变，
   * 这时候改一条消息（编辑、切版本、重答）会让写出来的摘要描述一条已经变了的路径。
   * 按钮跟着变灰，用户至少知道"现在动不了"，而不是点了没反应。
   */
  const compacting = useChatStore((state) => Boolean(state.compacting[session.id]))
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
  /** 上一次点「展开更早」时记下的锚点元素与它当时的视口位置 */
  const olderAnchorRef = useRef<{ el: Element; top: number } | null>(null)
  /**
   * 刚点过「展开更早」，按钮暂时收起来。
   *
   * 不这么做的话，补完的同一帧按钮还停在原处、只是数字变小了，看着像"点了没反应"。
   * 用户滑回顶部时（见 scroll 回调）它再出现——那时它就是要指的东西。
   */
  const [olderHidden, setOlderHidden] = useState(false)
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

  /** 正在跑的「回到底部」动画帧号，0 表示没在跑 */
  const jumpFrameRef = useRef(0)

  /**
   * 用户主动按了「回到底部」。
   *
   * 和 `scrollToBottom` 不是一回事：那个会被「用户已经离开底部」挡掉，这个必须真的下去，
   * 并按用户的意思重新打开贴底跟随。带一小段动画——瞬移会让人分不清是页面跳了还是
   * 自己点错了。终点每帧重算：消息上有 `content-visibility`，滚进视口的那些会从估算高度
   * 换成真实高度，总高度在这一路上一直在变，开头算一次的话最后会停在离底部差一截的地方。
   */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    cancelAnimationFrame(jumpFrameRef.current)
    stickyRef.current = true
    const apply = (top: number) => {
      el.scrollTop = top
      scrollTopRef.current = el.scrollTop
    }
    // 系统里关掉了动画就直接到底，不给这段过渡
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      apply(el.scrollHeight)
      return
    }
    const start = el.scrollTop
    const startedAt = performance.now()
    const step = () => {
      const target = el.scrollHeight - el.clientHeight
      const progress = Math.min(1, (performance.now() - startedAt) / JUMP_DURATION_MS)
      if (progress >= 1) {
        apply(el.scrollHeight)
        jumpFrameRef.current = 0
        return
      }
      // ease-out：起步快、收尾稳，落到底部时不砸一下
      apply(start + (target - start) * (1 - (1 - progress) ** 3))
      jumpFrameRef.current = requestAnimationFrame(step)
    }
    jumpFrameRef.current = requestAnimationFrame(step)
  }, [])

  /** 用户自己动手就停下动画：手指按住屏幕时还在写 scrollTop，会跟他抢 */
  const stopJump = useCallback(() => {
    if (jumpFrameRef.current !== 0) {
      cancelAnimationFrame(jumpFrameRef.current)
      jumpFrameRef.current = 0
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
  const scrollApi = useMemo(
    () => ({ scrollToBottom, jumpToBottom, holdAt }),
    [scrollToBottom, jumpToBottom, holdAt]
  )

  /**
   * 往前补一批更早的消息。
   *
   * 补偿**不能按 scrollHeight 差算**：消息上有 content-visibility，屏幕外的消息先按
   * contain-intrinsic-size 估高，滚进视口才换成真实高度，滚动高度会在补载的同一帧里
   * 被这批估值纠正（实测多算了 12.7 倍）。所以改记「某个元素当时在视口里的位置」，
   * 渲染后把它挪回原处——估值怎么变都不影响这条。
   */
  /**
   * 用户点了「展开更早的 N 条」：往前补一批。
   *
   * 以前是滑到离顶就自动补，那条路在长消息下会把用户从顶上推下去——补上来的内容全在他
   * 上方，而"把锚点挪回原处"等于把他从顶上撵走，一次补批等于五屏，猛滑一次追不回来，
   * 于是"怎么滑都到不了顶"。现在补载只由按钮触发，滚到顶本身不产生任何副作用。
   *
   * 补偿**不能按 scrollHeight 差算**：消息上有 content-visibility，屏幕外的消息先按
   * contain-intrinsic-size 估高，滚进视口才换成真实高度，滚动高度会在补载的同一帧里
   * 被这批估值纠正（实测多算了 12.7 倍）。所以改记「某个元素当时在视口里的位置」，
   * 渲染后把它挪回原处——估值怎么变都不影响这条。
   */
  const expandOlder = useCallback(() => {
    const el = scrollRef.current
    const column = contentRef.current
    if (!el || !column || olderAnchorRef.current || start === 0) {
      return
    }
    /**
     * 锚点取**第一条消息**，不能按固定下标取 `column.children[n]`。
     *
     * 卡片、原文块、这颗「展开更早」按钮都排在消息前面，个数还会随状态变：
     * 有压缩就有卡片，原文展开着多一块，按钮刚点完就被收起来。按下标数，锚点很容易
     * 落到卡片或按钮上——卡片钉在顶上不动、按钮一点就消失，量出来的补偿量都是 0，
     * 视口于是纹丝不动，用户看到的是"新内容直接跳出来、旧内容没了"。
     * 所以按「不是这几种非消息节点」来认第一条真正的消息。
     */
    const anchor = [...column.children].find(
      (child) => !/^(card|originals|olderMore)-/.test(String(child.className)),
    )
    if (!anchor) {
      return
    }
    olderAnchorRef.current = { el: anchor, top: anchor.getBoundingClientRect().top }
    // 点过就先把按钮收起来；等用户真的滑回顶部（见 scroll 回调）它再出现
    setOlderHidden(true)
    setWindowState((state) => ({
      sessionId: session.id,
      start: expandOlderStart(
        messages,
        state.sessionId === session.id ? state.start : initialWindowStart(messages.length),
        OLDER_CHUNK,
      ),
    }))
  }, [session.id, messages, start])

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
    /**
     * 补偿完仍在顶部附近（补上来的内容还没一屏高，或者它已经被自动锚定吸收了），
     * 说明没把用户"推离顶部"，那就没必要把按钮藏起来。
     *
     * 不这么兜一下会卡住：把 scrollTop 写成它本来就在的值不会触发 scroll 事件，
     * 而按钮复原只挂在 scroll 回调上，于是它可能一直不回来。
     */
    if (el.scrollTop < LOAD_OLDER_THRESHOLD) {
      setOlderHidden(false)
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

  /**
   * 把切换后的版本选择器钉回它切换前所在的那条水平线。
   *
   * 只量一次不够。切版本会换掉这条回复的整棵子树，这一帧里新内容还没布局，
   * 消息上的 `content-visibility` 先用估算高度顶着，滚动容器的高度会瞬间塌下去，
   * 浏览器顺手把 `scrollTop` 夹小 —— 长会话底部实测从 5.5 万直接夹到 0。
   * 等真实高度回来，位置已经丢了。所以按帧补，直到高度连续两帧不再变化为止。
   */
  const pinVersionAnchor = useCallback(
    (scroll: HTMLElement, anchor: { messageId: string; top: number }) => {
      const selector = `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      let frames = 0
      let lastHeight = -1
      let stable = 0
      const step = () => {
        const switcher = scroll.querySelector<HTMLElement>(selector)
        if (switcher) {
          const delta = switcher.getBoundingClientRect().top - anchor.top
          if (Math.abs(delta) >= 1) {
            scroll.scrollTop += delta
            scrollTopRef.current = scroll.scrollTop
            const metrics = cutMetricsRef.current
            if (metrics) {
              metrics.top = scroll.scrollTop
              metrics.height = scroll.scrollHeight
            }
          }
        }
        const height = scroll.scrollHeight
        stable = height === lastHeight ? stable + 1 : 0
        lastHeight = height
        frames += 1
        // 高度稳定两帧就收工；最多盯 40 帧（约 0.6 秒），不跟用户的手抢
        if (frames < 40 && stable < 2) {
          requestAnimationFrame(step)
        }
      }
      requestAnimationFrame(step)
    },
    []
  )

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      restoreScrollRef.current = null
      pinVersionAnchor(scroll, anchor)
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom, pinVersionAnchor])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  /**
   * 换会话时先把按钮收起来。
   *
   * 不能挂在 `lastMessageId` 上——用户正往上翻旧消息时来了新的一条，那颗按钮不该跟着消失。
   * 真正的显隐仍然由滚动位置决定，这里只是把上一个会话的结论清掉，等新会话滚到底部
   * 时由 scroll 事件重新算。
   */
  useLayoutEffect(() => {
    setFarFromBottom(false)
  }, [session.id])

  // 离开会话页（回到欢迎页或换页）时也把它清掉，别让别的界面继承这个状态
  useEffect(() => () => setFarFromBottom(false), [])

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
      /**
       * 滚回顶部附近时，把「展开更早」的按钮放回去。
       *
       * 补载**不再**由滚动触发：以前滑到离顶 400px 就自动补，补上来的内容全在用户上方，
       * 补偿把人从顶上撵走，一次补批就是几屏，猛滑一次追不回来——"怎么滑都到不了顶"。
       * 现在到顶只是到顶，什么都不发生。
       */
      if (olderHidden && el.scrollTop < LOAD_OLDER_THRESHOLD) {
        setOlderHidden(false)
      }
      // 「回到底部」那颗按钮跟着走：这条判断必须在 scroll 里做，
      // 别的地方拿不到"用户此刻看到的是哪一屏"
      setFarFromBottom(
        nextJumpVisible(useFarFromBottom.getState().far, distanceFromBottom(el))
      )
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', stopJump, { passive: true })
    el.addEventListener('wheel', stopJump, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', stopJump)
      el.removeEventListener('wheel', stopJump)
      cancelAnimationFrame(jumpFrameRef.current)
      jumpFrameRef.current = 0
    }
  }, [isMobile, scrollToBottom, start, olderHidden, stopJump])

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
            {/*
              更早的消息按次展开：一次 20 条。
              以前是滑到顶自动补，那套在长回复下会把人从顶上撵走（见 expandOlder 的注释）。
              `start` 归零表示已经展开到头，按钮自然消失。
            */}
            {start > 0 && !olderHidden ? (
              <button type="button" className={styles.olderMore} onClick={expandOlder}>
                {t('loadOlderMore', { count: Math.min(OLDER_CHUNK, start) })}
                {/*
                  括号里是**总数**（这次要展开的也算在内），不是"展开后还剩多少"。
                  最后一批（不足 20 条）也照样带上括号，不再换一套只有前半句的文案——
                  同一个按钮只有一种说法，省得人以为换了东西。
                */}
                {t('loadOlderRemaining', { remaining: start })}
              </button>
            ) : null}
            {shown.map((message, offset) => {
              // 下标按整段消息算：窗口只影响挂多少，不影响"是不是第一条/最后一条"
              const index = start + offset
              return message.role === 'user' ? (
                <UserMessage
                  key={messageKey(message)}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming || compacting}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              ) : (
                <AssistantMessage
                  /*
                   * key 的取法见 messageKeys.ts：提问和回答必须落到不同的 key 上，
                   * 否则一轮问答的两条消息会互相冒领，往上翻补载时提问会重复一份。
                   * 回答仍按父消息取，是为了换版本时复用同一个组件实例。
                   */
                  key={messageKey(message)}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming || compacting}
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

