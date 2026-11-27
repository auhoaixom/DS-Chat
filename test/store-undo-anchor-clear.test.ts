import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getContextUsage } from '../src/services/chat/compaction.js'
import * as db from '../src/services/chat/db.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { initChat, selectSession, sendMessage, useChatStore } from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { startFakeStream } from './fakeStream.js'
import { userMessage } from './helpers.js'

/**
 * 撤销时挂上的锚点只是临时的：新的回复带回实测之后就该交还给"最近一条"，
 * 否则它会一直把面板钉在压缩前那个数上。
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

test('新的实测到了之后，撤销时挂上的锚点自动交还', async () => {
  await db.saveSession({
    id: 'a',
    title: '交还',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('问', 'a-m1')],
    // 模拟"撤销压缩后挂着一个指回旧回复的锚点"
    anchorId: '一条不存在的旧回复',
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const stream = startFakeStream()
  try {
    setDraftText('a', '再问一句')
    sendMessage('a')
    await waitFor(() => Object.hasOwn(useChatStore.getState().streaming, 'a'), '流已开始')
    stream.begin('好的。')
    await waitFor(
      () => useChatStore.getState().sessionCache.a?.anchorId === undefined,
      '锚点被交还'
    )
  } finally {
    stream.restore()
  }

  const after = useChatStore.getState().sessionCache.a
  assert.ok(after)
  // 交还之后按"最近一条带实测的回复"算，不会崩
  const usage = getContextUsage(after)
  assert.ok(usage)
  assert.notEqual(usage.anchorId, undefined)
})
