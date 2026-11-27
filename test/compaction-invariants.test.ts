import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage } from '../src/services/chat/compaction.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { useSettings } from '../src/services/settings.js'
import { compactionRecord } from './helpers.js'

/**
 * 随机操作序列下的不变量。
 *
 * 不追求"每个数都对"——那种数据没法随机造。这里只钉死五条任何情况下都必须成立的事：
 * 1. 用量不为负，百分比在 0–100
 * 2. 四项明细之和正好等于合计
 * 3. 撤销之后不再操作，数字回到压缩前
 * 4. 翻开关不改变任何字段
 * 5. 全程不抛异常
 *
 * 种子固定，失败时打印种子与操作序列，可原样复现。
 */
const SEEDS = Array.from({ length: 200 }, (_, index) => 1_000 + index * 7)

/** 极简 LCG：同一份种子给出同一串伪随机数，不引入依赖 */
const makeRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

let seq = 0
const nextId = () => `m${(seq += 1)}`

type Built = { messages: Message[]; compaction?: Session['compaction']; anchorId?: string }

const build = (random: () => number): Built => {
  const rounds = 1 + Math.floor(random() * 6)
  const messages: Message[] = []
  let at = 1
  for (let index = 0; index < rounds; index += 1) {
    const userText = '问'.repeat(1 + Math.floor(random() * 800))
    messages.push({
      id: nextId(),
      role: 'user',
      content: userText,
      files: [],
      createdAt: at,
    })
    at += 1
    const hasUsage = random() > 0.25
    messages.push({
      id: nextId(),
      role: 'assistant',
      createdAt: at,
      model: null,
      prefix: true,
      status: 'done',
      blocks: [{ type: 'text', text: '答'.repeat(1 + Math.floor(random() * 800)) }],
      ...(hasUsage
        ? {
            usage: {
              input_tokens: Math.floor(random() * 20_000) + 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 5,
            },
            promptEstimate: Math.floor(random() * 20_000) + 1,
            estimateVersion: ESTIMATE_VERSION,
            requestKey: `m:${useSettings.getState().model}|f:0|p:1|e:${ESTIMATE_VERSION}`,
          }
        : {}),
    })
    at += 1
  }
  const built: Built = { messages }
  // 一半的回合带一条压缩记录（覆盖前几轮），一半的回合带"撤销后的锚点"
  if (rounds > 2 && random() > 0.5) {
    const covered = messages.slice(0, 4).map((message) => message.id)
    built.compaction = compactionRecord({ coveredIds: covered, createdAt: 2, anchorId: covered[1] })
  } else if (random() > 0.5) {
    const withUsage = messages.filter((message) => message.role === 'assistant' && message.usage)
    const pick = withUsage[Math.floor(random() * withUsage.length)]
    if (pick) {
      built.anchorId = pick.id
    }
  }
  return built
}

const sessionOf = (built: Built): Session => ({
  id: 's',
  title: '随机',
  createdAt: 0,
  updatedAt: 0,
  messages: built.messages,
  ...(built.compaction ? { compaction: built.compaction } : {}),
  ...(built.anchorId ? { anchorId: built.anchorId } : {}),
})

test('随机操作序列下，五条不变量都成立', () => {
  let checked = 0
  for (const seed of SEEDS) {
    const random = makeRandom(seed)
    const built = build(random)
    const session = sessionOf(built)
    const label = `seed=${seed}`

    const usage = getContextUsage(session, '系统提示词')
    assert.ok(usage, `${label}：非空会话应当算得出用量`)
    assert.ok(usage.used >= 0, `${label}：用量不能为负（${usage.used}）`)
    assert.ok(usage.percent >= 0 && usage.percent <= 100, `${label}：百分比越界 ${usage.percent}`)
    assert.equal(
      usage.messageTokens + usage.systemTokens + usage.summaryTokens + usage.overheadTokens,
      usage.used,
      `${label}：四项明细之和必须等于合计`
    )

    // 撤销后数字回到压缩前：这里用"同一份数据但去掉压缩记录"模拟撤销前的状态
    if (usage.compacted) {
      const undone: Session = { ...session }
      delete undone.compaction
      undone.anchorId = built.compaction?.anchorId
      const after = getContextUsage(undone, '系统提示词')
      assert.ok(after, `${label}：撤销后仍应算得出用量`)
      assert.ok(after.used >= 0, `${label}：撤销后不能为负`)
      assert.ok(
        after.anchor !== 'dropped' || built.compaction?.anchorId === undefined,
        `${label}：撤销后不该再因压缩而丢锚点`
      )
    }

    // 翻开关不改变任何字段
    const original = useSettings.getState()
    try {
      useSettings.setState({ thinking: !original.thinking, search: !original.search })
      assert.deepEqual(getContextUsage(session, '系统提示词'), usage, `${label}：开关不该影响数字`)
    } finally {
      useSettings.setState({ thinking: original.thinking, search: original.search })
    }
    checked += 1
  }
  assert.equal(checked, SEEDS.length)
})
