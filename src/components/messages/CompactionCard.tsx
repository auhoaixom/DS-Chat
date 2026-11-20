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
import type { Compaction } from '../../services/chat/types.js'
import { IconChevronDownOutline14, IconCompressOutline14 } from '../base/icons.js'
import { Markdown } from '../markdown/Markdown.js'
import styles from './CompactionCard.module.css'

/**
 * 消息列表顶部的压缩卡片：正在压缩时显示进度，压缩后显示摘要入口与撤销。
 * 被摘要覆盖的原始消息不再渲染，展开卡片可以查看摘要正文。
 */
export const CompactionCard = ({
  sessionId,
  compaction,
}: {
  sessionId: string
  compaction?: Compaction
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

  const saved = Math.max(0, compaction.beforeTokens - compaction.afterTokens)
  return (
    <div className={styles.card}>
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
          {' · '}
          {t('compactionTokenFlow', {
            before: formatTokens(compaction.beforeTokens),
            after: formatTokens(compaction.afterTokens),
          })}
        </span>
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
