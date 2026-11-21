import clsx from 'clsx'
import { useState } from 'react'
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
import styles from './CompactionCard.module.css'

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
 */
export const CompactedOriginals = ({ messages }: { messages: Message[] }) => {
  const t = useTranslate()
  return (
    <div className={styles.originals} aria-label={t('compactionOriginalsTitle')}>
      <div className={styles.originalsTitle}>{t('compactionOriginalsTitle')}</div>
      {messages.map((message) =>
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
