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
 * 删除一条正在生成回答的对话，删除要**等这条流收尾**再动数据
 * （store.ts 里 `await waitForIdle(id)`，注释写的是「避免删除之后又被收尾保存写回来」）。
 *
 * 这条测试守的就是这个顺序：流没结束时不能删，收尾之后才真的删。
 */
test('删正在流式的对话：先等流收尾，再真删', async () => {
  await db.saveSession({
    id: 'a',
    title: '正在回复的对话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()
  setApiKey('test-key')

  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const stream = startFakeStream()
  try {
    setDraftText('a', '讲个长故事')
    sendMessage('a')
    await waitFor(() => Object.hasOwn(useChatStore.getState().streaming, 'a'), '流已经开始')

    let deleted = false
    const deletion = removeSession('a').then((ok) => {
      deleted = true
      return ok
    })

    // 流还开着：删除必须卡住，数据也不能动
    await sleep(150)
    assert.equal(deleted, false, '流还没收尾就把会话删掉了')
    assert.equal(
      useChatStore.getState().sessions.some((session) => session.id === 'a'),
      true,
      '流还没收尾，会话就已经从列表里消失',
    )

    stream.end()
    assert.equal(await deletion, true)
    await waitFor(() => !Object.hasOwn(useChatStore.getState().streaming, 'a'), '流已收尾')
  } finally {
    stream.restore()
  }

  const state = useChatStore.getState()
  assert.equal(state.sessions.some((session) => session.id === 'a'), false)
  assert.equal(state.activeId, null)
  assert.equal(Object.hasOwn(state.sessionCache, 'a'), false)
  // 删除之后不能再被收尾保存写回来
  assert.equal(await db.loadSession('a'), undefined)
})
