import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  cancelCompaction,
  undoCompaction,
  useChatStore,
  type CompactionRun,
} from '../../services/chat/store.js'
import { formatTokens } from '../../services/chat/tokens.js'
import type { Compaction, Message } from '../../services/chat/types.js'
import { IconChevronDownOutline14, IconCompressOutline14 } from '../base/icons.js'
import { Markdown } from '../markdown/Markdown.js'
import { nextOriginalsEnd, ORIGINALS_ROUNDS, pinnedFromSentinel } from './originalsWindow.js'
import { countTurns } from './messageWindow.js'
import { setOriginalsPinned, useOriginalsPinned } from './originalsPinnedState.js'
import { findScrollParent } from './scrollParent.js'
import styles from './CompactionCard.module.css'

/**
 * 原文列表首屏挂多少条，由 `nextOriginalsEnd` 按轮算（一批 5 轮，轮 = 用户消息），
 * 之后每点一次「继续展开」再多 5 轮。见 originalsWindow.ts。
 */

/**
 * 消息列表顶部的压缩卡片：正在压缩时显示进度；压缩后给出摘要、原文与撤销。
 * 「查看原文」只展开被覆盖的消息，不改变压缩状态、也不影响请求。
 */
export const CompactionCard = ({
  sessionId,
  compaction,
  coveredCount,
  originalsOpen,
  onToggleOriginals,
}: {
  sessionId: string
  compaction?: Compaction
  /** 当前分支上真正被覆盖的消息条数；0 表示覆盖段已失效 */
  coveredCount: number
  originalsOpen: boolean
  onToggleOriginals: () => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const run = useChatStore((state): CompactionRun | undefined => state.compacting[sessionId])
  /**
   * 必须和上面几个 hook 并排，**不能放到下面那两个提前返回之后**。
   *
   * 提前返回会让这个组件在不同状态下调用不同个数的 hook：压缩中返回 3 个、压缩完走到这里变 4 个、
   * 撤销压缩后又回到 3 个。React 一发现个数变了就整棵子树抛错，于是压缩完成那一刻报
   * 「Rendered more hooks than during the previous render」（#310）、撤销压缩那一刻报
   * 「Rendered fewer hooks than expected」（#300），两次都掉进「界面出错了」的兜底页。
   * 用户点「重试」能恢复，是因为重新挂载后 hook 个数从第一帧起就是一致的——数据其实早就写好了。
   */
  const pinned = useOriginalsPinned((state) => state.pinned)

  if (run) {
    return (
      <div className={clsx(styles.card, styles.running)} role="status" aria-live="polite">
        <div className={styles.head}>
          <span className={clsx(styles.icon, styles.pulse)}>
            <IconCompressOutline14 />
          </span>
          <span className={styles.title}>
            {run.phase === 'chunk'
              ? t('compactionChunkProgress', { done: run.done + 1, total: run.total })
              : t('compactionRunning')}
          </span>
          <span className={styles.meta}>
            {t('compactionProgressChars', { count: run.chars })}
          </span>
        </div>
        {run.mode === 'manual' ? (
          <div className={styles.footer}>
            <span className={styles.footnote}>{t('compactionRunningHint')}</span>
            <button
              type="button"
              className={styles.action}
              onClick={() => cancelCompaction(sessionId)}
            >
              {t('compactionStop')}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  if (!compaction) {
    return null
  }

  /**
   * 只显示"省了多少"，不显示 before → after 两个绝对值。
   * 原因：这两个字段在 v0.7.7 换过含义（旧：整个上下文压缩前后；新：被替换的原文 vs 摘要），
   * 老记录被按新含义显示会出现一堆对不上的数。差值在两种含义下都是"减少了多少"，不会解释错。
   */
  const saved = Math.max(0, compaction.beforeTokens - compaction.afterTokens)
  /**
   * 展开原文时卡片吸顶，随手就能收起或撤销。
   *
   * 用户滑过原文块之后不再退出吸顶——那样是布局开关，只能瞬间切换，看着像"啪"地消失。
   * 改成吸顶保持不变、把卡片整体推上去（`data-away`），视觉上是"收起来"。
   * 想收起原文得往回滑，这是定下的取舍，所以这里不给别的入口。
   *
   * **摘要展开着也照样吸顶**。早先这里写的是 `originalsOpen && !open`，本意是怕长摘要钉在
   * 顶上吃掉半个屏幕；但摘要区本来就限了 46vh 并在卡片里自己滚，那个担心并不成立，
   * 而代价很实在：用户点箭头的那一刻卡片从 `sticky` 掉回正常流，直接飞回整条对话的最顶上
   * （真机实测 top 从 60 变成 −22202），得往上滑很久才找得回来——点的是卡片上的按钮，
   * 东西却跑掉了。所以吸顶只看原文开没开。
   *
   * `pinned` 这个 hook 不在这里调用——见文件顶部那一段说明。
   */
  const sticky = originalsOpen
  return (
    <div
      className={clsx(styles.card, sticky && styles.sticky)}
      data-away={sticky && !pinned ? 'true' : undefined}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.icon}>
          <IconCompressOutline14 />
        </span>
        <span className={styles.title}>
          {t('compactionCardTitle')}
        </span>
        {saved > 0 ? (
          <span className={styles.meta}>
            {t('compactionCardSaved', { tokens: formatTokens(saved) })}
          </span>
        ) : null}
        <span className={clsx(styles.chevron, open && styles.chevronOpen)}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open ? (
        <div className={styles.summary}>
          <Markdown
            content={compaction.summary}
            loading={false}
            cacheKey={`compaction-${compaction.createdAt}`}
            disableLink={false}
          />
        </div>
      ) : null}
      {compaction.legacy ? (
        <div className={styles.legacyNote}>{t('compactionLegacyNote')}</div>
      ) : null}
      <div className={styles.footer}>
        <span className={styles.footnote}>
          {t(compaction.mode === 'auto' ? 'compactionModeAuto' : 'compactionModeManual')}
        </span>
        {coveredCount > 0 ? (
          <button
            type="button"
            className={styles.action}
            aria-expanded={originalsOpen}
            onClick={onToggleOriginals}
          >
            {t(originalsOpen ? 'compactionHideOriginals' : 'compactionShowOriginals')}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.action}
          onClick={() => undoCompaction(sessionId)}
        >
          {t('compactionUndo')}
        </button>
      </div>
    </div>
  )
}

/**
 * 已压缩原文的只读展示：变暗、不参与版本切换与编辑，纯粹是为了让人回看。
 * 展开它不会让这些消息重新进入请求。
 *
 * 分段渲染，但**由用户点「继续展开」驱动**，不再跟滚动位置联动。
 * 联动过一版：滚动到已渲染的末尾就自动补一批。那个判定只看位置不看方向，
 * 一旦视口整块越过原文跑到很下面（点「回到底部」、拖滚动条），条件照样成立，
 * 会一路把几百条原文全部渲染出来——正好撞在分段要防的那件事上。
 * 现在点一次多 5 轮，渲染量完全由用户决定。
 *
 * 方向和会话正文相反：正文进入时停在最底端，所以挂末尾一屏；原文是从头开始读的，
 * 所以挂开头。往末尾追加不会顶动上面的位置，因此不需要滚动锚定。
 */
export const CompactedOriginals = ({ messages }: { messages: Message[] }) => {
  const t = useTranslate()
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  /**
   * 已经展开到第几条。
   *
   * 由「继续展开」推着走，不跟滚动位置联动。收起原文、换会话时这个组件都会卸载重挂，
   * 状态自然回到首批，所以不需要额外的重置 effect；同一条会话里压缩记录变大就保持
   * 用户已经展开到的位置，变小由下面那个 clamp 兜住。
   */
  const [shown, setShown] = useState(() => nextOriginalsEnd(messages, 0, ORIGINALS_ROUNDS))
  const taken = Math.min(shown, messages.length)
  /** 还剩几轮；轮 = 用户发过几条消息（与消息列表同一口径），不是剩下的条数 */
  const remaining = countTurns(messages, taken, messages.length)

  /**
   * 告诉卡片「用户有没有滑过原文块」，决定它还要不要贴在屏幕顶上。
   *
   * 判定用末尾那颗零高度的哨兵：它的底边落在滚动容器顶部之下，就说明原文块还没被越过。
   *
   * **不用 IntersectionObserver**：它只在「相交／不相交」翻转时回调。用户停在原文内部时
   * 哨兵在视口下方（不相交），点「回到底部」一步跳到末尾后哨兵在视口上方（还是不相交），
   * 状态没翻转就一次回调都不会来，卡片会一直吸着。手势滑动碰不到这个坑（哨兵会先经过视口，
   * 翻转两次），但跳转是几帧内直接跨过——所以这里老老实实按滚动位置量，每帧最多量一次。
   *
   * `shown` 变化也要重量：点「继续展开」不产生滚动，但哨兵跟着原文块一起往下挪了。
   */
  useEffect(() => {
    const root = rootRef.current
    const sentinel = sentinelRef.current
    const scroller = findScrollParent(root)
    if (!root || !sentinel || !scroller) {
      return
    }
    const measure = () => {
      const box = sentinel.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      setOriginalsPinned(pinnedFromSentinel(box.bottom, view.top))
    }
    let frame = 0
    const schedule = () => {
      // 滚动里量矩形会强制布局；同一帧里的多个事件只该付一次这笔钱
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0
          measure()
        })
      }
    }
    measure()
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
    }
  }, [shown, messages.length])

  // 收起原文（组件卸载）时把状态归位，下次展开从头来过
  useEffect(() => () => setOriginalsPinned(true), [])

  return (
    <div ref={rootRef} className={styles.originals} aria-label={t('compactionOriginalsTitle')}>
      <div className={styles.originalsTitle}>{t('compactionOriginalsTitle')}</div>
      {messages.slice(0, taken).map((message) =>
        message.role === 'user' ? (
          <div key={message.id} className={styles.originalUser}>
            {message.content || message.files.map((file) => file.name).join('、')}
          </div>
        ) : (
          <div key={message.id} className={styles.originalReply}>
            <Markdown
              content={message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')}
              loading={false}
              cacheKey={`original-${message.id}`}
              disableLink={false}
            />
          </div>
        )
      )}
      {remaining > 0 ? (
        <button
          type="button"
          className={styles.originalsMore}
          onClick={() => setShown(nextOriginalsEnd(messages, taken, ORIGINALS_ROUNDS))}
        >
          {t('compactionOriginalsMore', { count: remaining })}
        </button>
      ) : null}
      {/* 零高度哨兵：它滚出滚动容器顶部，就表示原文块被整块越过了（见上面的 observer） */}
      <div ref={sentinelRef} className={styles.originalsEnd} aria-hidden />
    </div>
  )
}
