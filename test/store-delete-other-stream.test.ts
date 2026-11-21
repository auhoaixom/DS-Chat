import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initChat,
  removeSession,
  selectSession,
  sendMessage,
  useChatStore,
} from '../src/services/chat/store.js'
import { setDraftText } from '../src/services/chat/drafts.js'
import { setApiKey } from '../src/services/settings.js'
import * as db from '../src/services/chat/db.js'
import { userMessage } from './helpers.js'
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 删除 A 只等 A 自己的流（`waitForIdle(id)` 是按会话等的）。
 * 如果写成等所有流，删一条对话就会被另一条正在生成的对话拖住 —— 用户看到的是「删除没反应」。
 */
test('删 A 不会被 B 正在生成的回答拖住', async () => {
  for (const id of ['a', 'b']) {
    await db.saveSession({
      id,
      title: `对话 ${id}`,
      createdAt: 1,
      updatedAt: 1,
      messages: [userMessage(`${id} 的消息`, `${id}-m1`)],
    })
  }
  await initChat()
  setApiKey('test-key')

  selectSession('b')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'b'), 'B 读进缓存')

  const stream = startFakeStream()
  try {
    setDraftText('b', '讲个很长的故事')
    sendMessage('b')
    await waitFor(() => Object.hasOwn(useChatStore.getState().streaming, 'b'), 'B 的流已经开始')

    // B 的流还开着，此时删 A：必须立刻完成，不能等 B
    const outcome = await Promise.race([
      removeSession('a').then((ok) => (ok ? 'deleted' : 'failed')),
      sleep(800).then(() => 'timeout'),
    ])
    assert.equal(outcome, 'deleted', '删除被另一条会话的流拖住了')

    const state = useChatStore.getState()
    assert.equal(state.sessions.some((session) => session.id === 'a'), false)
    assert.equal(state.activeId, 'b')
    assert.equal(
      Object.hasOwn(state.streaming, 'b'),
      true,
      'B 的流被误伤了：它不该受删 A 的影响',
    )
    assert.equal(await db.loadSession('a'), undefined)
    // B 的数据还在，没被一起动
    assert.ok(await db.loadSession('b'))
  } finally {
    stream.restore()
  }
})
