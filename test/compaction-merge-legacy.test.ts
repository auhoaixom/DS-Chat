import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCompaction, getCoveredCount } from '../src/services/chat/compaction.js'
import type { Session } from '../src/services/chat/types.js'
import { compactionRecord, longConversation } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 已经压过一次、又压第二次：走的是**增量合并**（旧摘要 + 新削掉的那段），
 * 不再重发早就摘要过的原文。这条路径只在"压完继续聊、再压一次"时出现，
 * 真机上很少走到，但它是唯一会读旧摘要、并把旧记录的字段带进新记录的地方。
 *
 * 要守住的两点：
 * 1. 旧摘要原样进原料，但它**已经是摘要**，不许被当成原文重发一遍；
 * 2. 新记录是一个全新的对象，不许顺手继承旧记录的 `legacy` 之类的标记
 *    ——继承的后果是卡片对着一份刚写的摘要说"由早期版本写入"。
 */
test('二次压缩走增量合并：只发新削掉的那段，新记录不继承旧标记', async () => {
  const messages = longConversation()
  const previous = compactionRecord({
    summary: '旧摘要正文：用户一直在问问题',
    // 覆盖前 90 条，留 6 条给这次新压
    coveredIds: messages.slice(0, 90).map((message) => message.id),
    createdAt: 1,
    legacy: true,
  })
  const session: Session = {
    id: 's1',
    title: '二次压缩',
    createdAt: 0,
    updatedAt: 0,
    messages,
    compaction: previous,
  }

  const server = startScriptedFetch(() => ({ kind: 'text', text: '新摘要' }))
  let outcome: Awaited<ReturnType<typeof buildCompaction>>
  try {
    outcome = await buildCompaction({
      session,
      apiKey: 'test-key',
      model: 'deepseek-flash',
      mode: 'manual',
      signal: new AbortController().signal,
    })
  } finally {
    server.restore()
  }

  assert.equal(outcome.ok, true, '第二次压缩该成功')
  if (!outcome.ok) {
    return
  }
  const record = outcome.compaction

  // 手动压缩固定保留最近两轮：100 条里覆盖 96 条，旧覆盖段是它的前缀
  assert.equal(record.coveredIds.length, messages.length - 4)
  assert.equal(getCoveredCount(messages, record), record.coveredIds.length)

  assert.equal(server.summaryCalls().length, 1, '剩下的 6 条一发摘要就够，不该分段')
  const call = server.summaryCalls()[0]
  assert.ok(call)
  assert.match(String(call.body.system), /既有摘要/, '合并用的系统提示词要说明"输入里有既有摘要"')
  const raw = JSON.stringify(call.body.messages)
  assert.match(raw, /旧摘要正文/, '旧摘要要作为原料带过去')
  assert.doesNotMatch(raw, /问题 0：/, '早已摘要过的原文不许再发一遍')
  assert.match(raw, /问题 45：/, '新削掉的那几条要原样带过去')

  assert.equal(record.summary, '新摘要')
  assert.equal(record.viaReplay, false, '合并走的是摘要请求，不是回放')
  assert.equal(record.legacy, undefined, '新记录不是旧记录，legacy 不许跟过来')
  // 只丈量这次真正被替换掉的东西：新削掉的原文 + 旧摘要
  assert.ok(record.beforeTokens > 0 && record.afterTokens < record.beforeTokens)
})
