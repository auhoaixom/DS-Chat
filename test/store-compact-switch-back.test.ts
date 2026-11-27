import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getVisibleMessages } from '../src/services/chat/branches.js'
import { getContextUsage, getCoveredCount } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import {
  initChat,
  selectMessageVersion,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 压缩 → 在保留段里切版本 → 切回来。
 *
 * 切版本是"看"的动作，不该动数据：压缩记录必须原样留着、面板仍是"已压缩"。
 * 覆盖段里的版本切不动（硬性规定），所以这里切的是保留段——那也是唯一安全的位置：
 * 岔口在保留段，覆盖段原样不动。
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

test('在保留段里换版本再换回来：压缩记录原样还在，覆盖条数不变', async () => {
  await db.saveSession({
    id: 'a',
    title: '换版本',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { ...userMessage('第一问', 'u1'), parentId: null, selectedChildId: 'a1' },
      { ...reply('a1', '第一答'), parentId: 'u1', selectedChildId: 'u2' },
      { ...userMessage('第二问', 'u2'), parentId: 'a1', selectedChildId: 'a2' },
      // 保留段里的两个版本：切它在覆盖段之外，安全
      { ...reply('a2', '第二答'), parentId: 'u2' },
      { ...reply('a2b', '第二答（另一版）'), parentId: 'u2' },
    ],
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

  const original = useChatStore.getState().sessionCache.a
  assert.ok(original?.compaction)
  const covered = () =>
    getCoveredCount(
      getVisibleMessages(useChatStore.getState().sessionCache.a as never),
      original.compaction
    )
  assert.equal(covered(), 2, '前提：两条被盖住')

  selectMessageVersion('a', 'a2b')
  const onOther = useChatStore.getState().sessionCache.a
  assert.ok(onOther?.compaction, '切版本不该弄丢压缩记录')
  assert.equal(onOther.compaction.summary, original.compaction.summary)
  assert.equal(onOther.compaction.beforeTokens, original.compaction.beforeTokens)
  assert.deepEqual(
    getVisibleMessages(onOther).map((message) => message.id),
    ['u1', 'a1', 'u2', 'a2b'],
    '前提：版本真的切过去了'
  )
  // 岔口在保留段，覆盖段原样不动
  assert.equal(covered(), 2)
  const otherUsage = getContextUsage(onOther)
  assert.ok(otherUsage)
  assert.equal(otherUsage.compacted, true, '换了版本也还是压缩状态')

  selectMessageVersion('a', 'a2')
  const back = useChatStore.getState().sessionCache.a
  assert.ok(back?.compaction)
  assert.equal(covered(), 2)
  const backUsage = getContextUsage(back)
  assert.ok(backUsage)
  assert.equal(backUsage.compacted, true)
  assert.ok(backUsage.summaryTokens > 0)
})
