import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compactSession,
  initChat,
  selectSession,
  sendMessage,
  useChatStore,
} from '../src/services/chat/store.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { setApiKey } from '../src/services/settings.js'
import * as db from '../src/services/chat/db.js'
import { assistantMessage, userMessage } from './helpers.js'
import { startFakeStream } from './fakeStream.js'

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

/**
 * 正在生成回答时点「压缩上下文」必须被拒绝（返回 busy）。
 * 反过来做的话：压缩会替换掉正在被流式写入的那批消息，回复会写到一段已被压掉的上下文后面。
 */
test('正在生成回答时压缩返回 busy，且不会动数据', async () => {
  await db.saveSession({
    id: 'a',
    title: '正在回复的对话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1'), assistantMessage('你好呀', 'a-m2')],
  })
  await initChat()
  setApiKey('test-key')

  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const stream = startFakeStream()
  try {
    setDraftText('a', '再讲一段')
    sendMessage('a')
    await waitFor(() => Object.hasOwn(useChatStore.getState().streaming, 'a'), '流已经开始')

    assert.equal(await compactSession('a'), 'busy')
    assert.equal(useChatStore.getState().sessionCache.a.compaction, undefined)
  } finally {
    stream.restore()
  }
})
