import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage, requestKeyOf } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import {
  initChat,
  selectMessageVersion,
  selectSession,
  undoCompaction,
  useChatStore,
} from '../src/services/chat/store.js'
import { ESTIMATE_VERSION } from '../src/services/chat/tokens.js'
import { setApiKey, useSettings } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 压缩 → 切版本（保留段里的那条）→ 撤销压缩。
 *
 * 撤销会把"压缩前那个锚点"挂到会话上。压缩时生效的锚点通常是**最后一条带实测的回复**，
 * 它在保留段里；一旦用户把它的版本切走，锚点就不在当前路径上了。
 * 这时候必须静默退回"最近一条带实测的回复"，不能因为找不到就崩，也不能挂着指不到的数。
 *
 * 注意：覆盖段里的版本切不动（见 isCoveredBranchPoint 的硬性规定），
 * 所以能造成"锚点离开路径"的只有保留段里这一种切法。
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

const key = () => requestKeyOf({ model: useSettings.getState().model, hasFiles: false })

const usageOf = (input: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 5,
})

const reply = (id: string, text: string, input: number) => ({
  id,
  role: 'assistant' as const,
  createdAt: 2,
  model: null,
  prefix: true,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text }],
  usage: usageOf(input),
  promptEstimate: 800,
  estimateVersion: ESTIMATE_VERSION,
  requestKey: key(),
})

test('保留下来的那条被切走之后撤销压缩：锚点指不到就静默退回最近一条实测', async () => {
  await db.saveSession({
    id: 'a',
    title: '切走再撤销',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { ...userMessage('第一问', 'u1'), parentId: null, selectedChildId: 'a1' },
      { ...reply('a1', '第一答', 9_000), parentId: 'u1', selectedChildId: 'u2' },
      { ...userMessage('第二问', 'u2'), parentId: 'a1', selectedChildId: 'a2' },
      { ...reply('a2', '第二答', 400), parentId: 'u2', selectedChildId: 'u3' },
      { ...userMessage('第三问', 'u3'), parentId: 'a2', selectedChildId: 'a3' },
      // 压缩时生效的锚点：保留段里的最后一条回答
      { ...reply('a3', '第三答', 5_000), parentId: 'u3' },
      // 它的另一个版本：切过去之后 a3 就不在当前路径上了
      { ...reply('a3b', '第三答（另一版）', 4_200), parentId: 'u3' },
    ],
    compaction: {
      summary: '第一问第一答被压掉了',
      coveredIds: ['u1', 'a1'],
      createdAt: 10,
      mode: 'manual',
      beforeTokens: 1_000,
      afterTokens: 100,
      model: null,
      anchorId: 'a3',
    },
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  selectMessageVersion('a', 'a3b')
  const switched = useChatStore.getState().sessionCache.a
  assert.equal(
    switched?.messages.find((message) => message.id === 'u3')?.selectedChildId,
    'a3b',
    '前提：保留段里的版本切得动（硬性规定只冻结覆盖段）'
  )
  assert.equal(switched?.anchorId, undefined, '前提：此时会话上还没有挂锚点')

  undoCompaction('a')

  const session = useChatStore.getState().sessionCache.a
  assert.equal(session?.compaction, undefined, '记录要删掉')
  assert.equal(session?.anchorId, 'a3', '撤销时照常把它挂上去')

  const usage = getContextUsage(session)
  assert.ok(usage, '不许崩')
  // a3 已经不在当前路径上：退回常规查找，落在当前分支那条带实测的回复上
  assert.equal(usage.anchorId, 'a3b')
  assert.equal(usage.anchor, 'measured')
  assert.ok(usage.used > 0)
})
