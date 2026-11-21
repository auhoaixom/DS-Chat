import { translate } from '../../i18n/index.js'
import { estimateRequestTokens, getCacheStats, getContextUsage } from './compaction.js'
import { getVisibleMessages } from './branches.js'
import { SYSTEM_PROMPT } from './prompt.js'
import { estimateTokens, formatTokens } from './tokens.js'
import type { AssistantMessage, Session } from './types.js'

/** 明细里最多列多少条请求，避免长会话把弹窗撑爆 */
export const REQUEST_LIMIT = 12

const clock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour12: false })

/** 明细里的一段：没有小标题时只输出内容行 */
export type DiagnosticsDetail = {
  title?: string
  lines: string[]
}

/**
 * 诊断报告分成两段：
 * brief 是每项一行的结论，默认就展示这些；detail 是完整记录，展开才看。
 * 报告只读会话快照，不改任何状态、不发请求。
 */
export type DiagnosticsReport = {
  brief: string[]
  detail: DiagnosticsDetail[]
}

/**
 * 上下文这一段拆成几行，每行只说一件事：
 * 字数 → 当前请求的构成 → 不压缩会是多少 → 锚点从哪来。
 * 以前把这些挤在一行，同一个「系统提示词」既出现 14 又出现 1.2K，读起来像 bug。
 */
const compositionLines = (
  session: Session,
  t: typeof translate,
  usage: ReturnType<typeof getContextUsage>
): string[] => {
  const visible = getVisibleMessages(session)
  const text = visible.map((message) =>
    message.role === 'user'
      ? message.content
      : message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  )
  const joined = text.join('')
  let cjk = 0
  for (const char of joined) {
    if (/[\u2e80-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uff60]/.test(char)) {
      cjk += 1
    }
  }
  const lines = [
    `${t('diagnosticsChars')}: ${joined.length} (CJK ${cjk} / ASCII ${joined.length - cjk})`,
  ]
  if (!usage) {
    return lines
  }
  // 压缩后系统提示词里装的是摘要，标签得跟着变，否则又成了两个「系统提示词」
  const composition = [
    `${t(usage.compacted ? 'diagnosticsSummaryTokens' : 'contextSystem')} ${formatTokens(usage.systemTokens)}`,
    `${t(usage.compacted ? 'diagnosticsTailMessages' : 'contextMessages')} ${formatTokens(usage.messageTokens)}`,
    `${t('contextOverhead')} ${formatTokens(usage.overheadTokens)}`,
    `${t('diagnosticsTotal')} ${formatTokens(usage.used)}`,
  ]
  lines.push(`${t('diagnosticsComposition')}: ${composition.join(' · ')}`)

  // 没压缩时全量就等于当前，再列一遍只会让人以为有两个不同的数
  if (usage.compacted) {
    const fullMessages = estimateRequestTokens(visible)
    const fullSystem = estimateTokens(SYSTEM_PROMPT)
    const fullTotal = fullMessages + fullSystem
    const ratio = usage.used > 0 ? (fullTotal / usage.used).toFixed(1) : '1.0'
    lines.push(
      `${t('diagnosticsUncompacted')}: ${t('diagnosticsFullHistory')} ${formatTokens(fullMessages)}` +
        ` · ${t('contextSystem')} ${formatTokens(fullSystem)}` +
        ` · ${t('diagnosticsTotal')} ${formatTokens(fullTotal)}` +
        ` · ${t('diagnosticsTimesCurrent', { ratio })}`
    )
  }

  const anchorUsed = usage.anchorUsed ?? 0
  const anchorEstimate = usage.anchorEstimate ?? 0
  if (usage.anchor === 'measured') {
    const diff =
      anchorEstimate > 0 ? Math.round(((anchorUsed - anchorEstimate) / anchorEstimate) * 100) : 0
    lines.push(
      `${t('diagnosticsAnchor')}: ${t('diagnosticsAnchorMeasured', {
        used: anchorUsed,
        estimate: anchorEstimate,
        diff: `${diff > 0 ? '+' : ''}${diff}%`,
      })}`
    )
  } else if (usage.anchor === 'dropped') {
    lines.push(
      `${t('diagnosticsAnchor')}: ${
        usage.anchorDropReason === 'usage'
          ? t('diagnosticsAnchorDroppedUsage', { used: anchorUsed, estimate: anchorEstimate })
          : t('diagnosticsAnchorDroppedCompaction')
      }`
    )
  } else {
    lines.push(`${t('diagnosticsAnchor')}: ${t('diagnosticsAnchorNone')}`)
  }
  return lines
}

/** 请求明细：时间、模型、状态各占一行，用量单独一行（窄屏一行放不下） */
const requestLines = (replies: AssistantMessage[], t: typeof translate): string[] => {
  if (replies.length === 0) {
    return [`- ${t('diagnosticsNone')}`]
  }
  const lines: string[] = []
  for (const reply of replies.slice(-REQUEST_LIMIT)) {
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
  return lines
}

/** 摘要里的失败结论：只给条数与最近一条的原因，原文留在明细里 */
const failureBrief = (failures: AssistantMessage[], t: typeof translate): string => {
  if (failures.length === 0) {
    return `${t('diagnosticsFailures')}: ${t('diagnosticsNone')}`
  }
  const last = failures.at(-1)
  const error = last?.error
  const reason = error
    ? `${error.kind}${error.status === undefined ? '' : ` ${error.status}`}`
    : ''
  return `${t('diagnosticsFailures')}: ${t('diagnosticsFailureBrief', {
    count: failures.length,
    time: last ? clock(last.createdAt) : '-',
    reason,
  })}`
}

/**
 * 把当前对话摊成「结论 + 明细」：摘要是上线前最该看的那几个数，
 * 明细保留原本的全部记录，一条不删。
 */
export const buildDiagnosticsReport = (
  session: Session,
  t: typeof translate = translate
): DiagnosticsReport => {
  const visible = getVisibleMessages(session)
  const usage = getContextUsage(session, SYSTEM_PROMPT)
  const cache = getCacheStats(session)
  const replies = visible.filter((message): message is AssistantMessage => message.role === 'assistant')
  const failures = replies.filter((reply) => reply.error)
  const compaction = session.compaction

  const brief: string[] = [t('diagnosticsTitle'), `${t('diagnosticsSession')}: ${session.title}`]
  if (usage) {
    const percent = usage.percent === 0 && usage.used > 0 ? '<1%' : `${usage.percent}%`
    brief.push(
      `${t('diagnosticsContext')}: ${formatTokens(usage.used)} / ${formatTokens(usage.window)} (${percent})` +
        ` · ${t('diagnosticsMeasured')} ${t(usage.measured ? 'diagnosticsYes' : 'diagnosticsNo')}`
    )
  }
  if (cache) {
    brief.push(
      `${t('contextCacheHit')}: ${cache.percent}%` +
        ` (${cache.read} / ${cache.total}, ${cache.requests} ${t('diagnosticsRequests')})`
    )
  }
  // 附件按 1500/2000 计入估算，但只有带 serverId 的才会真正进入请求
  const files = visible.flatMap((message) => (message.role === 'user' ? message.files : []))
  const orphan = files.filter((file) => file.serverId === null)
  // 抓取结果块的正文加密在 signature 里，估算只能按每处固定值计
  const fetched = visible.reduce(
    (sum, message) =>
      message.role === 'user'
        ? sum
        : sum + message.blocks.filter((block) => block.type === 'web_fetch_tool_result').length,
    0
  )
  brief.push(
    `${t('diagnosticsFiles')} ${files.length}` +
      ` · ${t('diagnosticsFileOrphans')} ${orphan.length}` +
      ` · ${t('diagnosticsFetched')} ${fetched}`
  )
  // 摘要要压在一行内（真机 720 宽只有约 24 个汉字的位置），所以只给前后值与条数
  brief.push(
    compaction
      ? `${t('diagnosticsCompaction')}: ${clock(compaction.createdAt)}` +
          ` ${t(compaction.mode === 'auto' ? 'diagnosticsModeAuto' : 'diagnosticsModeManual')}` +
          ` ${formatTokens(compaction.beforeTokens)} → ${formatTokens(compaction.afterTokens)}` +
          ` · ${t('diagnosticsCoveredCount', { count: compaction.coveredIds.length })}`
      : `${t('diagnosticsCompaction')}: ${t('diagnosticsNone')}`
  )
  brief.push(failureBrief(failures, t))

  const detail: DiagnosticsDetail[] = [{ lines: compositionLines(session, t, usage) }]
  if (compaction) {
    const parts = [
      `${t('diagnosticsReplay')} ${t(compaction.viaReplay ? 'diagnosticsYes' : 'diagnosticsNo')}`,
      `${t('diagnosticsCovered')} ${compaction.coveredIds.length}`,
    ]
    const summaryUsage = compaction.summaryUsage
    if (summaryUsage) {
      parts.push(
        `in ${summaryUsage.input} hit ${summaryUsage.cacheRead} write ${summaryUsage.cacheWrite}`
      )
    }
    detail.push({ lines: [`${t('diagnosticsCompaction')}: ${parts.join(' · ')}`] })
  }
  detail.push({
    title: `${t('diagnosticsRecentRequests')} (${t('diagnosticsLastN', { count: REQUEST_LIMIT })})`,
    lines: requestLines(replies, t),
  })
  detail.push({
    title: t('diagnosticsFailures'),
    lines:
      failures.length === 0
        ? [`- ${t('diagnosticsNone')}`]
        : failures.map((reply) => {
            const error = reply.error
            return `- ${clock(reply.createdAt)}  ${error?.kind ?? '-'}${
              error?.status === undefined ? '' : ` ${error.status}`
            }  ${error?.message ?? ''}`
          }),
  })

  return { brief, detail }
}

/** 只拼明细，供折叠区展示 */
export const composeDetail = (report: DiagnosticsReport): string => {
  const lines: string[] = []
  for (const section of report.detail) {
    if (lines.length > 0) {
      lines.push('')
    }
    if (section.title) {
      lines.push(section.title)
    }
    lines.push(...section.lines)
  }
  return lines.join('\n')
}

/** 复制出去的是整份报告：结论在前、明细在后，与是否展开无关 */
export const composeReport = (report: DiagnosticsReport): string =>
  [report.brief.join('\n'), composeDetail(report)].filter((part) => part !== '').join('\n\n')
