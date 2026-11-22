import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { findScrollParent } from './scrollParent.js'
import styles from './CompactionCard.module.css'

/** 原文列表首屏挂多少条（从头开始读，所以挂开头） */
const INITIAL_ORIGINALS = 20
/** 往下滚一次补多少条 */
const ORIGINALS_CHUNK = 5
/** 原文块下沿离视口底部这么近就补一批 */
const ORIGINALS_LOAD_THRESHOLD = 900

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
  // 展开原文后卡片吸顶：翻到多深都能直接收起或撤销，不用再滚回顶部
  const sticky = originalsOpen && !open
  return (
    <div className={clsx(styles.card, sticky && styles.sticky)}>
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
 * 分段挂载方向和会话正文**相反**：正文进入时停在最底端，所以挂末尾一屏；
 * 原文是从头开始读的，所以挂**开头**一屏，往下滚再往末尾补。
 * 补载只往末尾追加，不会顶动上面的位置，因此不需要做滚动锚定。
 */
export const CompactedOriginals = ({ messages }: { messages: Message[] }) => {
  const t = useTranslate()
  const rootRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(() => Math.min(INITIAL_ORIGINALS, messages.length))

  // 换了一条对话或压缩记录变了：回到一屏
  useEffect(() => {
    setShown(Math.min(INITIAL_ORIGINALS, messages.length))
  }, [messages.length])

  /** 原文块下沿快进视口了就补一批 */
  const loadMore = useCallback(() => {
    const root = rootRef.current
    const scroller = findScrollParent(root)
    if (!root || !scroller) {
      return
    }
    const box = root.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    if (box.bottom - view.bottom >= ORIGINALS_LOAD_THRESHOLD) {
      return
    }
    setShown((count) =>
      count >= messages.length ? count : Math.min(messages.length, count + ORIGINALS_CHUNK),
    )
  }, [messages.length])

  useEffect(() => {
    const scroller = findScrollParent(rootRef.current)
    if (!scroller) {
      return
    }
    scroller.addEventListener('scroll', loadMore, { passive: true })
    return () => scroller.removeEventListener('scroll', loadMore)
  }, [loadMore])

  /**
   * 每次挂完再自检一次。
   *
   * 必须有这一步：用户一口气甩到 scroller 底部时，滚动位置已经加不动、不会再产生 scroll 事件，
   * 光靠监听器会卡在中间某一批（实测停在 66 条，剩下的一直出不来）。这里补完一批就看一眼，
   * 还够得着就继续补，直到补满或者下沿已经离得够远。
   */
  useEffect(() => {
    loadMore()
  }, [shown, loadMore])

  return (
    <div ref={rootRef} className={styles.originals} aria-label={t('compactionOriginalsTitle')}>
      <div className={styles.originalsTitle}>{t('compactionOriginalsTitle')}</div>
      {messages.slice(0, shown).map((message) =>
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
    </div>
  )
}
