import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { messageAllPeak, messageCostNano } from '../../services/chat/cost.js'
import { formatCost, formatRate } from '../../services/chat/pricing.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import styles from './MessageCost.module.css'

/** token 数按三位加空格：窄屏上比千分位逗号好认，也不受语言影响 */
const groupDigits = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const clock = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 一类 token 的明细；数量为 0 的类别不占行（没用到就没有这一笔） */
const Bucket = ({ label, tokens, rate }: { label: string; tokens: number; rate: number }) =>
  tokens > 0 ? (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailTokens}>{`${groupDigits(tokens)} × ${formatRate(rate)}`}</span>
      <span className={styles.detailAmount}>{formatCost(tokens * rate)}</span>
    </div>
  ) : null

/**
 * 一条回复的花费。
 *
 * 只有带成本记录的回复才出现：导入的会话、旧版本留下的消息没有这个字段，
 * 这里返回 null，界面上连那一行都不存在——「不知道」和「花了 0 元」要长得不一样。
 * 金额来自请求发生时写下的记录，不按当前价目表重算。
 */
export const MessageCost = ({ message }: { message: AssistantMessage }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: 'top', align: 'start', offset: 6, maxHeight: 360 }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { swallowOutsideClick: true })

  const costs = message.costs ?? []
  if (costs.length === 0) {
    return null
  }
  const peak = messageAllPeak(message)
  const amount = formatCost(messageCostNano(message))

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        <button
          type="button"
          className={clsx(styles.trigger, open && styles.triggerOpen)}
          aria-label={t('messageCostAria', { amount })}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          {peak ? <span className={styles.peakTag}>{t('messageCostPeak')}</span> : null}
          <span>{amount}</span>
        </button>
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.panel}
              style={position ?? undefined}
              role="dialog"
              aria-label={t('messageCostDetailTitle')}
            >
              {costs.map((cost, index) => (
                <div key={`${cost.at}-${index}`} className={styles.request}>
                  <div className={styles.requestHead}>
                    <span>{t(cost.peak ? 'messageCostDetailPeak' : 'messageCostDetailOffPeak')}</span>
                    {/* 一次请求占绝大多数；续写才有第二条，那时才需要时间把两条区分开 */}
                    {costs.length > 1 ? (
                      <span className={styles.requestTime}>{clock(cost.at)}</span>
                    ) : null}
                  </div>
                  <Bucket
                    label={t('messageCostDetailMiss')}
                    tokens={cost.input}
                    rate={cost.rates.miss}
                  />
                  <Bucket
                    label={t('messageCostDetailHit')}
                    tokens={cost.cacheRead}
                    rate={cost.rates.hit}
                  />
                  <Bucket
                    label={t('messageCostDetailWrite')}
                    tokens={cost.cacheWrite}
                    rate={cost.rates.write}
                  />
                  <Bucket
                    label={t('messageCostDetailOut')}
                    tokens={cost.output}
                    rate={cost.rates.out}
                  />
                  {costs.length > 1 ? (
                    <div className={styles.subtotal}>{formatCost(cost.nano)}</div>
                  ) : null}
                </div>
              ))}
              <div className={styles.total}>
                <span>{t('messageCostDetailTotal')}</span>
                <span className={styles.totalAmount}>{amount}</span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
