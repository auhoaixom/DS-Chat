import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyCompaction,
  estimateRequestTokens,
  getContextUsage,
  getCoveredCount,
  getSessionModel,
  hasGain,
  isContextOverflowError,
  planCompaction,
} from '../src/services/chat/compaction.js'
import { ApiError } from '../src/services/api/client.js'
import { SAFETY_CHECK, SYSTEM_PROMPT, safetyCheckField } from '../src/services/chat/prompt.js'
import { useSettings } from '../src/services/settings.js'
import type { Session } from '../src/services/chat/types.js'
import { assistantMessage, at, compactionRecord, conversation, userMessage } from './helpers.js'

const ids = (count: number) => Array.from({ length: count }, (_, index) => `m${index + 1}`)

// ── planCompaction ─────────────────────────────────────────────

test('消息太少（不足 4 条）时没有可压的东西', () => {
  assert.equal(planCompaction([], 1_000_000), null)
  assert.equal(planCompaction(conversation(1), 1_000_000), null)
  assert.equal(planCompaction(conversation(1).slice(0, 3), 1_000_000), null)
})

test('手动压缩：固定保留最近两轮，其余被覆盖', () => {
  const messages = conversation(5) // 10 条
  const plan = planCompaction(messages, 1_000_000, { manual: true })
  assert.ok(plan)
  assert.equal(plan.keptCount, 4)
  assert.equal(plan.coveredIds.length, 6)
  assert.deepEqual(
    plan.coveredIds,
    messages.slice(0, 6).map((message) => message.id)
  )
})

test('切点落在回答上要前移到一个提问，避免留下没有提问的孤立回答', () => {
  // 6 条 + 一条落单回答：手动压缩的切点正好落在第 4 条（回答）上
  const messages = [...conversation(3), userMessage('问题 3'), assistantMessage('回答 3'), assistantMessage('追问')]
  const plan = planCompaction(messages, 1_000_000, { manual: true })
  assert.ok(plan)
  // 保留段以助手消息开头时整体前移，结果必须从提问开始
  const keptStart = messages.length - plan.keptCount
  assert.equal(messages[keptStart]?.role, 'user')
  assert.equal(messages[messages.length - plan.keptCount]?.role, 'user')
})

test('前移之后覆盖段不足 2 条，就不压', () => {
  // 只有第一条是提问，后面全是回答：切点一路前移到末尾
  const messages = [userMessage('问'), assistantMessage('答 1'), assistantMessage('答 2')]
  assert.equal(planCompaction(messages, 1_000_000, { manual: true }), null)
})

test('超限抢救：只保留最后一轮', () => {
  const messages = conversation(5)
  const plan = planCompaction(messages, 1_000_000, { aggressive: true })
  assert.ok(plan)
  assert.equal(plan.keptCount, 2)
  assert.equal(plan.coveredIds.length, 8)
})

test('窗口足够大时自动压缩不成立', () => {
  assert.equal(planCompaction(conversation(5), 1_048_576), null)
})

test('窗口收窄后自动压缩会挑出一段早期消息', () => {
  // 每条消息约 150 token；120 条远超 8000 的保留下限，才有东西可压
  const messages = Array.from({ length: 60 }, (_, index) => [
    userMessage(`问题${index}：${'甲'.repeat(200)}`),
    assistantMessage(`回答${index}：${'乙'.repeat(200)}`),
  ]).flat()
  const plan = planCompaction(messages, 20_000)
  assert.ok(plan)
  assert.ok(plan.coveredIds.length >= 2)
  assert.ok(plan.coveredTokens > 0)
  const keptStart = messages.length - plan.keptCount
  assert.equal(messages[keptStart]?.role, 'user')
})

test('会话本身就装得下时，自动压缩不出手', () => {
  // 同样 20K 窗口，但整段对话不到 8000 token 的保留下限
  assert.equal(planCompaction(conversation(200), 20_000), null)
})

// ── applyCompaction / getCoveredCount ──────────────────────────

test('覆盖段是开头连续前缀时，请求里被摘要替换', () => {
  const messages = conversation(3)
  const covered = messages.slice(0, 4).map((message) => message.id)
  const record = compactionRecord({ coveredIds: covered })

  const applied = applyCompaction(messages, record)
  assert.equal(applied.summary, record.summary)
  assert.deepEqual(
    applied.history.map((message) => message.id),
    messages.slice(4).map((message) => message.id)
  )
  assert.equal(getCoveredCount(messages, record), 4)
})

test('覆盖段不再连续（切过分支）时整体忽略', () => {
  const messages = conversation(3)
  const record = compactionRecord({ coveredIds: [at(messages, 0).id, at(messages, 2).id] })

  const applied = applyCompaction(messages, record)
  assert.equal(applied.summary, null)
  assert.equal(applied.history, messages)
  assert.equal(getCoveredCount(messages, record), 0)
})

test('覆盖段里混进了后面的消息时也不生效', () => {
  const messages = conversation(3)
  const record = compactionRecord({
    coveredIds: [at(messages, 0).id, at(messages, 1).id, at(messages, 4).id],
  })
  assert.equal(getCoveredCount(messages, record), 0)
})

test('没有压缩记录时原样返回', () => {
  const messages = conversation(2)
  assert.deepEqual(applyCompaction(messages), { history: messages, summary: null })
  assert.equal(getCoveredCount(messages), 0)
  assert.deepEqual(applyCompaction(messages, compactionRecord()), {
    history: messages,
    summary: null,
  })
})

test('覆盖了整个对话时全部换成摘要', () => {
  const messages = conversation(2)
  const record = compactionRecord({ coveredIds: messages.map((message) => message.id) })
  assert.deepEqual(applyCompaction(messages, record).history, [])
  assert.equal(getCoveredCount(messages, record), messages.length)
})

// ── hasGain：摘要有没有真的变小 ────────────────────────────────

test('摘要至少比被替换的原文小 5% 才算有收益', () => {
  assert.equal(hasGain(1_000, 900), true)
  // 949 是刚好过线的最小值
  assert.equal(hasGain(1_000, 949), true)
  // 恰好省下 5%：不算收益，避免拿一次请求换回等量的摘要
  assert.equal(hasGain(1_000, 950), false)
  assert.equal(hasGain(1_000, 1_600), false)
  // 两边用同一套口径后，被夹成 0 的情况不再出现
  assert.equal(hasGain(11_000, 0), true)
})

// ── isContextOverflowError ────────────────────────────────────

const httpError = (status: number, message: string) =>
  new ApiError('http', message, status)

test('常见的超限报文能被识别', () => {
  assert.equal(
    isContextOverflowError(httpError(400, 'prompt is too long: 1200000 tokens > 1048576')),
    true
  )
  assert.equal(isContextOverflowError(httpError(413, 'Request entity too large')), true)
  assert.equal(isContextOverflowError(httpError(422, 'input is too large')), true)
  assert.equal(isContextOverflowError(httpError(400, '上下文长度超出上限')), true)
  assert.equal(isContextOverflowError(httpError(500, 'maximum context window exceeded')), true)
})

test('不是超限的失败不能被误判，否则会白白压掉一次上下文', () => {
  assert.equal(isContextOverflowError(httpError(401, 'invalid api key')), false)
  assert.equal(isContextOverflowError(httpError(403, 'forbidden')), false)
  assert.equal(isContextOverflowError(httpError(429, 'rate limited')), false)
  // 状态码在名单里，但内容跟长度无关
  assert.equal(isContextOverflowError(httpError(400, 'invalid request: bad tool schema')), false)
  assert.equal(isContextOverflowError(httpError(404, 'model not found')), false)
})

test('非 HTTP 错误与普通异常一律不算超限', () => {
  assert.equal(isContextOverflowError(new ApiError('network', 'connection reset')), false)
  assert.equal(isContextOverflowError(new Error('prompt is too long')), false)
  assert.equal(isContextOverflowError(undefined), false)
  assert.equal(isContextOverflowError('too long'), false)
})

test('被覆盖消息的 id 保持原顺序', () => {
  const messages = conversation(4)
  const plan = planCompaction(messages, 1_000_000, { manual: true })
  assert.ok(plan)
  assert.deepEqual(plan.coveredIds, ids(plan.coveredIds.length).map((_, index) => at(messages, index).id))
})

// ── getContextUsage：实测锚点与估算的口径 ──────────────────────

const answered = (text: string, createdAt: number, promptEstimate: number) => ({
  ...assistantMessage(text),
  createdAt,
  promptEstimate,
  usage: {
    input_tokens: 9_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1_000,
    output_tokens: 10,
  },
})

const sessionOf = (messages: Session['messages'], compaction?: Session['compaction']): Session => ({
  id: 's1',
  title: '测试会话',
  createdAt: 0,
  updatedAt: 0,
  messages,
  compaction,
})

test('有实测锚点时，占用按服务端回报的真实用量算', () => {
  const messages = [userMessage(`问：${'甲'.repeat(2_000)}`), answered(`答：${'乙'.repeat(2_000)}`, 100, 800)]
  const usage = getContextUsage(sessionOf(messages))
  assert.ok(usage)
  assert.equal(usage.measured, true)
  assert.equal(usage.anchor, 'measured')
  assert.ok(usage.used > 9_000)
})

test('明细三项相加正好等于总用量，请求开销不被算进对话消息', () => {
  const messages = [userMessage(`问：${'甲'.repeat(2_000)}`), answered(`答：${'乙'.repeat(2_000)}`, 100, 800)]
  const usage = getContextUsage(sessionOf(messages))
  assert.ok(usage)
  assert.equal(
    usage.messageTokens + usage.systemTokens + usage.overheadTokens,
    usage.used
  )
  // 请求开销与对话消息分开算：800 的固定开销不该混进"对话消息"里
  assert.ok(usage.overheadTokens > 0)
  assert.ok(usage.messageTokens > usage.overheadTokens)
})

test('服务端用量小到不合常理时丢弃锚点，退回纯估算', () => {
  // 只回了输出侧、提示侧全是 0 的用量：当成实测会把整段上下文压成几十 token
  const zeroed = {
    ...answered(`答：${'乙'.repeat(2_000)}`, 100, 1_200),
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 20,
    },
  }
  const usage = getContextUsage(sessionOf([userMessage(`问：${'甲'.repeat(2_000)}`), zeroed]))
  assert.ok(usage)
  assert.equal(usage.measured, false)
  assert.equal(usage.anchor, 'dropped')
  assert.equal(usage.anchorDropReason, 'usage')
  // 估算全量是几千 token，绝不是"只剩回答本身"
  assert.ok(usage.used > 2_000)
  assert.equal(usage.anchorUsed, 0)
  assert.equal(usage.anchorEstimate, 1_200)
})

test('短请求的估算与实测同一个量级，固定开销不再虚高一个数量级', () => {
  // 真机实测（82374919*61525321，17 个 ASCII 字符）：服务端整份提示侧只有 64 token
  const estimated = estimateRequestTokens([userMessage('82374919*61525321', 'q1')])
  assert.ok(estimated >= 64 && estimated < 120, `估算 ${estimated} 应与实测 64 同量级`)
})

test('估算口径改小后，旧锚点也不会把占用拉成 0', () => {
  // 这条回答的 promptEstimate 是旧口径（800 开销）存下的 828，比现在的估算大得多
  const stale = {
    ...answered('答：2', 100, 828),
    usage: {
      input_tokens: 64,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 20,
    },
  }
  const usage = getContextUsage(sessionOf([userMessage('82374919*61525321'), stale]), SYSTEM_PROMPT)
  assert.ok(usage)
  assert.equal(usage.measured, true)
  // 净增减为负时停在实测值上，不夹成 0、也不冒出负增长
  assert.equal(usage.used, 64)
  // 系统提示词按比例摊分后是十来个 token，不会再被摊成 1
  assert.ok(usage.systemTokens > 1, `系统提示词摊成了 ${usage.systemTokens}`)
})

test('压缩之后不再沿用更早的锚点，否则巨大负增量会把占用夹成 0', () => {
  const first = userMessage(`问：${'甲'.repeat(2_000)}`)
  const answer = answered(`答：${'乙'.repeat(2_000)}`, 100, 800)
  const second = userMessage(`再问：${'丙'.repeat(500)}`)
  const followed = answered(`再答：${'丁'.repeat(500)}`, 200, 900)
  const messages = [first, answer, second, followed]

  const before = getContextUsage(sessionOf(messages))
  const after = getContextUsage(
    sessionOf(
      messages,
      compactionRecord({ coveredIds: [first.id, answer.id], createdAt: 300, summary: '被压掉的旧内容' })
    )
  )
  assert.ok(before && after)
  assert.equal(before.measured, true)
  // 锚点比压缩记录更早，就退回纯估算
  assert.equal(after.measured, false)
  assert.equal(after.anchor, 'dropped')
  assert.equal(after.anchorDropReason, 'compaction')
  assert.ok(after.used > 0)
  assert.ok(after.used < before.used)
  assert.equal(after.compacted, true)
})

test('压缩记录比锚点更早时，锚点照常有效', () => {  const first = userMessage(`问：${'甲'.repeat(2_000)}`)
  const answer = answered(`答：${'乙'.repeat(2_000)}`, 100, 800)
  const later = answered(`答二：${'丁'.repeat(200)}`, 500, 1_200)
  const usage = getContextUsage(
    sessionOf([first, answer, userMessage('追问'), later], compactionRecord({ coveredIds: [first.id], createdAt: 50 }))
  )
  assert.ok(usage)
  assert.equal(usage.measured, true)
})

// ── getSessionModel：模型名不再写死 ────────────────────────────

test('会话里记过模型就用记的那个，没记过就用设置里的', () => {
  const original = useSettings.getState().model
  try {
    useSettings.setState({ model: 'deepseek-chat-v9' })
    assert.equal(getSessionModel(sessionOf([])), 'deepseek-chat-v9')

    const replied = sessionOf([userMessage('问'), { ...answered('答', 100, 100), model: 'recorded-model' }])
    assert.equal(getSessionModel(replied), 'recorded-model')
  } finally {
    useSettings.setState({ model: original })
  }
})

// ── safety_check：默认不声明 ─────────────────────────────────

test('安全审核默认关闭：请求体里整个 safety_check 字段都不出现', () => {
  /**
   * 这是产品决定，不是随手写的默认值：开着会让服务端在输出结束后再审一遍
   * （连接挂更久）、网页抓取先过审、审核 token 计入 output_tokens。
   * 谁要把 SAFETY_CHECK 改回 { level: 'high' }，先让这条断言失败、再改它。
   */
  assert.equal(SAFETY_CHECK, undefined)
  assert.deepEqual(safetyCheckField(), {})
})
