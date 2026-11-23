import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  composeDetail,
  composeReport,
  buildDiagnosticsReport,
  REQUEST_LIMIT,
} from '../src/services/chat/diagnosticsReport.js'
import type { AssistantMessage, Compaction, Message, Session } from '../src/services/chat/types.js'
import { assistantMessage, compactionRecord, userMessage } from './helpers.js'

/** 测试里不需要真的文案：把参数原样拼在 key 后面，方便断言用的是哪条 */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join('|')})` : key

const session = (messages: Message[], compaction?: Compaction): Session => ({
  id: 's1',
  title: '产品方案讨论',
  createdAt: 0,
  updatedAt: 0,
  messages,
  compaction,
})

const reply = (over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  ...assistantMessage('回答'),
  servedModel: 'deepseek-chat',
  promptEstimate: 8_100,
  usage: {
    input_tokens: 8_200,
    cache_read_input_tokens: 7_000,
    cache_creation_input_tokens: 1_200,
    output_tokens: 630,
  },
  ...over,
})

const failed = (message: string, status: number): AssistantMessage =>
  reply({ status: 'error', error: { kind: 'http', message, status } })

test('摘要每项一行结论，不把请求明细和失败原文塞进去', () => {
  const report = buildDiagnosticsReport(
    session(
      [userMessage('问题'), reply(), failed('Rate limit reached', 429)],
      compactionRecord({ viaReplay: true })
    ),
    t
  )
  // 会话 + 密钥来源 + 上下文 + 命中率 + 附件 + 压缩 + 失败 = 八行以内
  assert.ok(report.brief.length <= 8, `摘要过长：${report.brief.length} 行`)
  for (const line of report.brief) {
    assert.ok(!line.includes('\n'), `摘要行内不该换行：${line}`)
  }
  const brief = report.brief.join('\n')
  // 逐条用量与失败原文只属于明细
  assert.ok(!brief.includes('in 8200'), '摘要把单条请求用量带出来了')
  assert.ok(!brief.includes('Rate limit reached'), '摘要把失败原文带出来了')
  // 密钥来源要在摘要里，数据究竟是不是真加密就看这一行
  assert.ok(brief.includes('settingsKeySource'), `密钥来源缺失：${brief}`)
  // 失败那一行必须给出条数与最近一条的原因，折叠着也不能有盲区
  assert.ok(brief.includes('diagnosticsFailureBrief(1|'), `失败结论缺失：${brief}`)
  assert.ok(brief.includes('diagnosticsFailures: '), `失败板块缺失：${brief}`)
})

test('明细保留请求用量、模型状态与失败原文', () => {
  const report = buildDiagnosticsReport(
    session([userMessage('问题'), reply(), failed('Rate limit reached', 429)]),
    t
  )
  const detail = composeDetail(report)
  assert.ok(detail.includes('in 8200 hit 7000 write 1200 out 630'), detail)
  assert.ok(detail.includes('est 8100'), detail)
  assert.ok(detail.includes('deepseek-chat'), detail)
  assert.ok(detail.includes('Rate limit reached'), detail)
  assert.ok(detail.includes('429'), detail)
  // 请求段落标题带上限条数，长会话也只列最近这么多
  assert.ok(detail.includes(`diagnosticsLastN(${REQUEST_LIMIT})`), detail)
})

test('没有压缩也没有失败时，摘要与明细都写「无」', () => {
  const report = buildDiagnosticsReport(session([userMessage('问题'), reply()]), t)
  const brief = report.brief.join('\n')
  assert.ok(brief.includes('diagnosticsCompaction: diagnosticsNone'), brief)
  assert.ok(brief.includes('diagnosticsFailures: diagnosticsNone'), brief)
  // 没有压缩就不必再给一条空的压缩明细
  const detail = composeDetail(report)
  assert.ok(!detail.includes('diagnosticsReplay'), detail)
  assert.ok(detail.includes('diagnosticsFailures'), detail)
})

test('空会话的明细直接写无，不报错', () => {
  const report = buildDiagnosticsReport(session([]), t)
  const detail = composeDetail(report)
  assert.ok(detail.includes(`- ${t('diagnosticsNone')}`), detail)
})

test('复制的全文是摘要在前、明细在后，与是否展开无关', () => {
  const report = buildDiagnosticsReport(session([userMessage('问题'), reply()]), t)
  const full = composeReport(report)
  const [head, ...rest] = full.split('\n\n')
  assert.equal(head, report.brief.join('\n'))
  assert.equal(rest.join('\n\n'), composeDetail(report))
})

test('上下文拆成「构成 / 不压缩 / 锚点」三行，同一个量不会再出现两个值', () => {
  const report = buildDiagnosticsReport(
    session(
      [userMessage('问题', 'm1'), { ...reply(), id: 'm2' }],
      compactionRecord({ coveredIds: ['m1'], createdAt: 100, summary: '摘要正文' })
    ),
    t
  )
  const detail = composeDetail(report)
  // 构成：压缩后系统提示词里装的是摘要，标签跟着变，不再叫「系统提示词」
  assert.ok(detail.includes('diagnosticsComposition'), detail)
  assert.ok(detail.includes('diagnosticsSummaryTokens'), detail)
  assert.ok(detail.includes('diagnosticsTailMessages'), detail)
  // 不压缩会是多少
  assert.ok(detail.includes('diagnosticsUncompacted'), detail)
  assert.ok(detail.includes('diagnosticsTimesCurrent('), detail)
  // 压缩让锚点失效：必须写成「已丢弃」，不能空着或冒充实测
  assert.ok(detail.includes('diagnosticsAnchorDroppedCompaction'), detail)
  // 旧口径的两段文案已删，不会再有第二个「系统提示词」数字
  assert.ok(!detail.includes('diagnosticsSystemEstimate'), detail)
  assert.ok(!detail.includes('diagnosticsEstimate:'), detail)
})

test('服务端用量不合常理时，明细写明锚点被丢弃和那两个数', () => {
  const zeroed: AssistantMessage = {
    ...reply(),
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 10,
    },
  }
  const report = buildDiagnosticsReport(session([userMessage('问题'), zeroed]), t)
  const detail = composeDetail(report)
  assert.ok(detail.includes('diagnosticsAnchorDroppedUsage(0|'), detail)
})
