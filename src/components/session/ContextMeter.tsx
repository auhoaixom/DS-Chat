import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { getCacheStats, getContextUsage } from '../../services/chat/compaction.js'
import { sessionCost } from '../../services/chat/cost.js'
import { PRICING_UPDATED_AT, formatCost } from '../../services/chat/pricing.js'
import { SYSTEM_PROMPT } from '../../services/chat/prompt.js'
import { cancelCompaction, compactSession, undoCompaction, useChatStore } from '../../services/chat/store.js'
import { formatTokensK } from '../../services/chat/tokens.js'
import type { Session } from '../../services/chat/types.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './ContextMeter.module.css'

/** 圆环几何：半径 7.5、线宽 2.2，viewBox 18×18 */
const RADIUS = 7.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * 顶栏的上下文占用入口：平时只显示一圈占比，点开才给明细和压缩操作。
 * 占用口径见 getContextUsage：服务端真实用量 + 对话表面净增减，所以压缩后立刻下降。
 */
export const ContextMeter = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const usage = useMemo(() => getContextUsage(session, SYSTEM_PROMPT), [session])
  const cache = useMemo(() => getCacheStats(session), [session])
  // 只统计有成本记录的回复：导入的历史与旧版本留下的消息没有这个字段
  const cost = useMemo(() => sessionCost(session), [session])
  const run = useChatStore((state) => state.compacting[session.id])
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    {
      side: 'bottom',
      align: 'end',
      offset: 6,
      maxHeight: 460,
      // 压缩开始/进入下一段时面板会换成进度布局，比空闲时高；
      // 不给这个标识，面板会沿用空闲时量出的高度，把底部的「停止」挤到边框上
      measureKey: run ? `${run.phase}:${run.done}/${run.total}` : 'idle',
    }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { swallowOutsideClick: true })

  if (!usage) {
    return null
  }

  const level =
    usage.compacted ? 'compacted' : usage.percent >= 80 ? 'danger' : usage.percent >= 60 ? 'warn' : 'normal'
  // 有一点占用就算不到 1%，也不要显示成 0%，否则看着像没在统计
  const percentLabel = usage.percent === 0 && usage.used > 0 ? '<1%' : `${usage.percent}%`

  const start = async () => {
    const result = await compactSession(session.id)
    if (result === 'done') {
      showToast({ key: 'compactionDone' })
    } else if (result === 'busy') {
      showToast({ key: 'compactionBusy' })
    } else if (result === 'no-gain') {
      showToast({ key: 'compactionNoGain' })
    } else if (result === 'empty') {
      showToast({ key: 'compactionNoNeed' })
    } else {
      showToast({ key: 'compactionFailed' })
    }
  }

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        <button
          type="button"
          className={clsx(styles.trigger, open && styles.triggerOpen)}
          aria-label={t('contextAria', { percent: percentLabel })}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className={styles.ring}>
            <circle className={styles.track} cx={9} cy={9} r={RADIUS} />
            <circle
              className={clsx(
                styles.fill,
                level === 'warn' && styles.fillWarn,
                level === 'danger' && styles.fillDanger,
                level === 'compacted' && styles.fillCompacted
              )}
              cx={9}
              cy={9}
              r={RADIUS}
              strokeDasharray={`${(usage.percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform="rotate(-90 9 9)"
            />
          </svg>
          <span className={styles.percent}>{percentLabel}</span>
        </button>
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.panel}
              style={position ?? undefined}
              role="dialog"
              aria-label={t('contextTitle')}
            >
              {/* 明细区自成一摞，内部间距归这些块自己；面板只负责块与块之间 */}
              <div className={styles.summary}>
                <div className={styles.head}>
                  <span className={styles.headline}>{t('contextUsed')}</span>
                  <span className={styles.headPercent}>{percentLabel}</span>
                </div>
                <div className={styles.figures}>
                  <span>
                    ≈ {formatTokensK(usage.used)}{' '}
                    <span className={styles.window}>/ {formatTokensK(usage.window)}</span>
                  </span>
                  {/* 拆分明细是估算摊分的结果，标出来免得被当成账单 */}
                  <span className={styles.anchor}>
                    {t(usage.measured ? 'contextAnchorMeasured' : 'contextAnchorEstimate')}
                  </span>
                </div>
                <div className={styles.bar}>
                  <span
                    className={clsx(styles.segment, styles.segmentFixed)}
                    style={{ flexGrow: Math.max(0, usage.systemTokens + usage.overheadTokens) }}
                  />
                  <span
                    className={clsx(styles.segment, styles.segmentSummary)}
                    style={{ flexGrow: Math.max(0, usage.summaryTokens) }}
                  />
                  <span
                    className={clsx(styles.segment, styles.segmentMessages)}
                    style={{ flexGrow: Math.max(0, usage.messageTokens) }}
                  />
                </div>
                <dl className={styles.rows}>
                  <div className={styles.row}>
                    <dt className={styles.swatchFixed}>{t('contextFixedCost')}</dt>
                    <dd>
                      ≈ {formatTokensK(usage.systemTokens + usage.overheadTokens)}
                    </dd>
                  </div>
                  {/* 摘要只在真有压缩记录时出现：撤销压缩后它就该整行消失，而不是留一个 <1K */}
                  {usage.compacted ? (
                    <div className={styles.row}>
                      <dt className={styles.swatchSummary}>{t('contextSummary')}</dt>
                      <dd>≈ {formatTokensK(usage.summaryTokens)}</dd>
                    </div>
                  ) : null}
                  <div className={styles.row}>
                    <dt className={styles.swatchMessages}>{t('contextMessages')}</dt>
                    <dd>≈ {formatTokensK(usage.messageTokens)}</dd>
                  </div>
                  {cache ? (
                    <div
                      className={styles.row}
                      title={t('contextCacheHitAria', {
                        percent: `${cache.percent}%`,
                        count: cache.requests,
                      })}
                    >
                      <dt className={styles.swatchCache}>{t('contextCacheHit')}</dt>
                      <dd>{`${cache.percent}%`}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {cost ? (
                <>
                  <div className={styles.divider} />
                  <div className={styles.cost}>
                    <div className={styles.costHead}>
                      <span>{t('costUsage')}</span>
                      <span className={styles.costAmount}>{formatCost(cost.nano)}</span>
                      {/* 只有压缩花过钱、没有已计价回复时，不写「0 条」 */}
                      {cost.priced > 0 ? (
                        <span className={styles.costRounds}>
                          {t('costPricedRounds', { count: cost.priced })}
                        </span>
                      ) : null}
                    </div>
                    {cost.unpriced > 0 ? (
                      <div className={styles.costNote}>
                        {t('costUnpricedRounds', { count: cost.unpriced })}
                      </div>
                    ) : null}
                    <div className={styles.costNote}>
                      {t('costPricingDate', { date: PRICING_UPDATED_AT })}
                    </div>
                  </div>
                </>
              ) : null}

              <div className={styles.divider} />

              {run ? (
                <div className={styles.progress} role="status" aria-live="polite">
                  <div className={styles.progressText}>
                    {run.phase === 'chunk'
                      ? t('compactionChunkProgress', { done: run.done + 1, total: run.total })
                      : t('compactionRunning')}
                  </div>
                  <div className={styles.progressMeta}>
                    {t('compactionProgressChars', { count: run.chars })}
                  </div>
                  {run.mode === 'manual' ? (
                    <Button
                      variant="outlined"
                      size="s"
                      className={styles.actionButton}
                      onClick={() => cancelCompaction(session.id)}
                    >
                      {t('compactionStop')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className={styles.actionsBlock}>
                  <p className={styles.hint}>{t('contextCompactHint')}</p>
                  <div className={styles.actions}>
                    <Button
                      variant="outlined"
                      size="s"
                      className={styles.actionButton}
                      onClick={() => void start()}
                    >
                      {t('compactionButton')}
                    </Button>
                    {session.compaction ? (
                      <Button
                        variant="outlined"
                        size="s"
                        className={styles.actionButton}
                        onClick={() => undoCompaction(session.id)}
                      >
                        {t('compactionUndo')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
