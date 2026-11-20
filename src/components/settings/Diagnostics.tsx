import { useMemo, useState } from 'react'
import { useTranslate, translate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { getCacheStats, getContextUsage } from '../../services/chat/compaction.js'
import { SYSTEM_PROMPT } from '../../services/chat/prompt.js'
import { formatTokens } from '../../services/chat/tokens.js'
import type { Session } from '../../services/chat/types.js'
import { useChatStore } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Diagnostics.module.css'

/** 生成的报告里最多列多少条，避免长会话把弹窗撑爆 */
const REQUEST_LIMIT = 12

const clock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour12: false })

/**
 * 把当前对话的可观测数据摊平成一段文本：最近若干轮的用量、压缩记录、失败记录。
 * 只读，不改任何状态；出问题时直接复制粘贴，不用再为读一个数字去改源码。
 */
const buildReport = (session: Session): string => {
  const t = (...args: Parameters<typeof translate>) => translate(...args)
  const visible = getVisibleMessages(session)
  const usage = getContextUsage(session, SYSTEM_PROMPT)
  const cache = getCacheStats(session)
  const replies = visible.filter((message) => message.role === 'assistant')
  const lines: string[] = []

  lines.push(t('diagnosticsTitle'))
  lines.push(`${t('diagnosticsSession')}: ${session.title}`)
  if (usage) {
    const percent = usage.percent === 0 && usage.used > 0 ? '<1%' : `${usage.percent}%`
    lines.push(
      `${t('diagnosticsContext')}: ${formatTokens(usage.used)} / ${formatTokens(usage.window)} (${percent})` +
        ` · ${t('contextMessages')} ${formatTokens(usage.messageTokens)}` +
        ` · ${t('contextSystem')} ${formatTokens(usage.systemTokens)}`
    )
    lines.push(
      `${t('diagnosticsMeasured')}: ${usage.measured ? t('diagnosticsYes') : t('diagnosticsNo')}`
    )
  }
  if (cache) {
    lines.push(
      `${t('contextCacheHit')}: ${cache.percent}% (${cache.read} / ${cache.total}, ${cache.requests} ${t('diagnosticsRequests')})`
    )
  }

  lines.push('')
  lines.push(`${t('diagnosticsRecentRequests')} (${t('diagnosticsLastN', { count: REQUEST_LIMIT })})`)
  if (replies.length === 0) {
    lines.push(`- ${t('diagnosticsNone')}`)
  }
  for (const reply of replies.slice(-REQUEST_LIMIT)) {
    // 每条拆成「时间 + 模型 + 状态」与「用量」两行：窄屏上一行放不下，交给浏览器换行会断得很难读
    const head = [`- ${clock(reply.createdAt)}`, reply.servedModel ?? reply.model ?? '-', reply.status]
    // 多个回答版本时标出，否则时间相邻看不出区别
    if (reply.selectedChildId !== undefined) {
      head.push('*')
    }
    lines.push(head.join('  '))
    const numbers: string[] = []
    if (reply.usage) {
      // prompt = in + hit + write，不再重复列出
      numbers.push(
        `in ${reply.usage.input_tokens}`,
        `hit ${reply.usage.cache_read_input_tokens}`,
        `write ${reply.usage.cache_creation_input_tokens}`,
        `out ${reply.usage.output_tokens}`
      )
    } else {
      numbers.push(t('diagnosticsNoUsage'))
    }
    if (reply.promptEstimate !== undefined) {
      numbers.push(`est ${reply.promptEstimate}`)
    }
    lines.push(`  ${numbers.join(' ')}`)
  }

  lines.push('')
  lines.push(t('diagnosticsCompaction'))
  const compaction = session.compaction
  if (compaction) {
    const details = [
      `${clock(compaction.createdAt)}`,
      compaction.mode,
      `${formatTokens(compaction.beforeTokens)} → ${formatTokens(compaction.afterTokens)}`,
      `${t('diagnosticsReplay')}: ${compaction.viaReplay ? t('diagnosticsYes') : t('diagnosticsNo')}`,
      `${t('diagnosticsCovered')}: ${compaction.coveredIds.length}`,
    ]
    if (compaction.summaryUsage) {
      details.push(
        `in ${compaction.summaryUsage.input} hit ${compaction.summaryUsage.cacheRead} write ${compaction.summaryUsage.cacheWrite}`
      )
    }
    lines.push(`- ${details.join('  ')}`)
  } else {
    lines.push(`- ${t('diagnosticsNone')}`)
  }

  lines.push('')
  lines.push(t('diagnosticsFailures'))
  const failures = replies.filter((reply) => reply.error)
  if (failures.length === 0) {
    lines.push(`- ${t('diagnosticsNone')}`)
  }
  for (const reply of failures) {
    const error = reply.error
    if (!error) {
      continue
    }
    lines.push(
      `- ${clock(reply.createdAt)}  ${error.kind}${error.status === undefined ? '' : ` ${error.status}`}  ${error.message}`
    )
  }

  return lines.join('\n')
}

export const Diagnostics = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    state.activeId === null ? undefined : state.sessionCache[state.activeId]
  )
  const [copied, setCopied] = useState(false)
  const report = useMemo(() => (session ? buildReport(session) : ''), [session])

  return (
    <Modal
      title={t('diagnosticsTitle')}
      closable
      onClose={onClose}
      mainClassName={styles.main}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={!report}
            onClick={async () => {
              if (!(await copyText(report))) {
                showToast({ key: 'copyFailed' })
                return
              }
              setCopied(true)
              showToast({ key: 'copied' })
            }}
          >
            {copied ? t('diagnosticsCopied') : t('copy')}
          </Button>
        </>
      }
    >
      {report ? <pre className={styles.report}>{report}</pre> : <p>{t('diagnosticsNoSession')}</p>}
    </Modal>
  )
}
