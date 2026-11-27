import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import { initChat, selectSession, undoCompaction, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { userMessage } from './helpers.js'

/**
 * 没有压缩记录时点「撤销压缩」是 no-op：不写盘、不抛错、不动锚点。
 * 界面上那个按钮只在有记录时出现，但导出/导入、并发操作都可能走到这里。
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

test('没有压缩记录时撤销是 no-op，锚点不动', async () => {
  await db.saveSession({
    id: 'a',
    title: '没压过',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('问', 'a-m1')],
    anchorId: 'a-m1',
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const before = useChatStore.getState().sessionCache.a
  undoCompaction('a')
  const after = useChatStore.getState().sessionCache.a

  assert.ok(before && after)
  assert.equal(after.compaction, undefined)
  assert.equal(after.anchorId, 'a-m1', '没有压缩记录时不该动锚点')
  assert.equal(after.messages.length, before.messages.length)
})
