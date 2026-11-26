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
import { setOriginalsPinned, useOriginalsPinned } from './originalsPinnedState.js'
import { findScrollParent } from './scrollParent.js'
import styles from './CompactionCard.module.css'

/**
 * 原文列表首屏挂多少条，由 `nextOriginalsEnd` 按轮算（一批 5 轮），
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
   * 卡片摘要自己展开着时不吸顶：那段摘要可能很长，钉在顶上会吃掉半个屏幕。
   */
  const pinned = useOriginalsPinned((state) => state.pinned)
  const sticky = originalsOpen && !open
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
  const remaining = messages.length - taken

  /**
   * 告诉卡片「用户有没有滑过原文块」，决定它还要不要贴在屏幕顶上。
   *
   * 判定用末尾那颗零高度的哨兵：它滚出滚动容器顶部，就说明原文已经被越过了。
   * 交给 IntersectionObserver 而不是在滚动回调里量矩形——那会在滚动中触发强制布局，
   * 而这里需要的只是"越过"那一下。拿不到滚动父级时保持原样（一直吸顶），
   * 宁可维持旧行为，也不让卡片突然不吸顶。
   */
  useEffect(() => {
    const root = rootRef.current
    const sentinel = sentinelRef.current
    const scroller = findScrollParent(root)
    if (!root || !sentinel || !scroller) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) {
          return
        }
        const rootTop = entry.rootBounds?.top ?? 0
        setOriginalsPinned(pinnedFromSentinel(entry.boundingClientRect.bottom, rootTop))
      },
      { root: scroller, threshold: 0 }
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
      // 收起原文：下次再展开时从头来过，卡片照常吸顶
      setOriginalsPinned(true)
    }
  }, [])

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
