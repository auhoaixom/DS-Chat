import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getVisibleMessages } from '../src/services/chat/branches.js'
import { applyCompaction, getContextUsage } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import {
  compactSession,
  initChat,
  selectMessageVersion,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 在保留段里换过版本之后，还能不能正常压缩？
 *
 * 这是"压缩 × 分支"最要紧的一条：换版本只影响保留段，覆盖段原样不动，
 * 所以再压一次时**上一次的摘要仍然有效**（能走增量合并，不必重发老原文），
 * 而新的覆盖段必须按**当前路径**来挑——换进来的那个版本绝不能出现在覆盖段里。
 */

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

const reply = (id: string, text: string) => ({
  id,
  role: 'assistant' as const,
  createdAt: 2,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text }],
})

test('换过版本再压缩：覆盖段按新路径挑，老摘要走增量合并', async () => {
  /** 一问一答交替，选中关系按树显式写好：u1→a1→u2→a2→…→u5→a5（另有版本 a5b） */
  const turn = (index: number) => {
    const next = index === 4 ? 'u5' : `u${index + 1}`
    return [
      {
        ...userMessage(`第${index}问：${'问'.repeat(200)}`, `u${index}`),
        parentId: index === 1 ? null : `a${index - 1}`,
        selectedChildId: `a${index}`,
      },
      {
        ...reply(`a${index}`, `第${index}答：${'答'.repeat(200)}`),
        parentId: `u${index}`,
        selectedChildId: next,
      },
    ]
  }
  const messages = [
    ...turn(1),
    ...turn(2),
    ...turn(3),
    ...turn(4),
    // 第五轮的回答有两个版本：换版本只动保留段
    {
      ...userMessage(`第五问：${'问'.repeat(200)}`, 'u5'),
      parentId: 'a4',
      selectedChildId: 'a5',
    },
    { ...reply('a5', '第五答'), parentId: 'u5' },
    { ...reply('a5b', '第五答（另一版）'), parentId: 'u5' },
  ]
  await db.saveSession({
    id: 'a',
    title: '换版本再压',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages,
    compaction: {
      summary: '第一问第一答被压掉了',
      coveredIds: ['u1', 'a1'],
      createdAt: 10,
      mode: 'manual',
      beforeTokens: 1_000,
      afterTokens: 100,
      model: null,
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  selectMessageVersion('a', 'a5b')
  const switched = useChatStore.getState().sessionCache.a
  assert.ok(switched)
  assert.equal(
    switched.messages.find((message) => message.id === 'u5')?.selectedChildId,
    'a5b',
    '前提：保留段里的版本切得动'
  )
  const path = getVisibleMessages(switched)

  const server = startScriptedFetch(() => ({ kind: 'text', text: '合并后的摘要' }))
  let result: string
  try {
    result = await compactSession('a')
  } finally {
    server.restore()
  }
  assert.equal(result, 'done', `压缩该成功，实际 ${result}`)

  const after = useChatStore.getState().sessionCache.a
  assert.ok(after?.compaction)
  const record = after.compaction

  // 手动压缩保留最近两轮：10 条路径里覆盖前 6 条，且必须是**当前路径**的前 6 条
  assert.deepEqual(
    record.coveredIds,
    path.slice(0, 6).map((message) => message.id),
    '覆盖段必须是当前路径的前缀'
  )
  assert.equal(record.coveredIds.includes('a5b'), false, '换进来的那个版本绝不能进覆盖段')
  assert.equal(record.coveredIds.includes('a5'), false, '被换下去的版本也不在路径上')

  // 上一次的覆盖段 [u1,a1] 仍然是这次的前缀 → 走增量合并：老原文不再重发
  assert.equal(record.viaReplay, false, '合并走的是摘要请求，不是回放')
  const summaryCall = server.summaryCalls()[0]
  assert.ok(summaryCall)
  const raw = JSON.stringify(summaryCall.body.messages)
  assert.match(raw, /第一问第一答被压掉了/, '旧摘要要作为原料带过去')
  assert.match(raw, /第3问/, '这次新削掉的那几条要原样带上')
  assert.doesNotMatch(raw, /第1问/, '早已摘要过的原文不许再发一遍')

  // 面板这一侧：摘要真的生效，且请求里用的是新路径
  const usage = getContextUsage(after)
  assert.ok(usage)
  assert.equal(usage.compacted, true)
  const applied = applyCompaction(getVisibleMessages(after), record)
  assert.equal(applied.summary, '合并后的摘要')
  assert.equal(applied.history.some((message) => message.id === 'a5b'), true, '换进来的版本要留在请求里')
})
