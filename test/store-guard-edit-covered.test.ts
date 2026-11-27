import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  editMessage,
  initChat,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { assistantMessage, userMessage } from './helpers.js'
import { startScriptedFetch } from './scriptedFetch.js'

/**
 * 硬性规定：被压缩盖掉的那段对话不许编辑。
 *
 * 编辑会在这条提问旁边岔出新分支——覆盖段的后半截就此离开当前路径，
 * 而摘要仍然描述着那段已经离开的对话。面板不会显示任何异常，
 * 模型却会接着一段用户以为已经改掉的上下文说话。
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

test('编辑覆盖段里的提问被拒绝，保留段里的照常可以', async () => {
  await db.saveSession({
    id: 'a',
    title: '改不得',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      userMessage('第一问', 'a-u1'),
      assistantMessage('第一答', 'a-a1'),
      userMessage('第二问', 'a-u2'),
      assistantMessage('第二答', 'a-a2'),
    ],
    compaction: {
      summary: '第一问第一答被压掉了',
      coveredIds: ['a-u1', 'a-a1'],
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

  const server = startScriptedFetch()
  try {
    const before = useChatStore.getState().sessionCache.a?.messages.length ?? 0
    assert.equal(editMessage('a', 'a-u1', '改过的第一问'), false, '覆盖段里的提问不许编辑')
    assert.equal(
      useChatStore.getState().sessionCache.a?.messages.length,
      before,
      '被拒绝时不许悄悄留下一条新分支'
    )
    assert.equal(server.calls.length, 0, '被拒绝时连请求都不该发')

    // 对照：保留段里的提问照常能编辑（否则这条测试可能只是"编辑功能坏了"）
    assert.equal(editMessage('a', 'a-u2', '改过的第二问'), true)
    assert.equal(
      useChatStore.getState().sessionCache.a?.messages.length,
      before + 2,
      '编辑会追加一条提问和一条待生成的回答'
    )
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '对照用的流结束')
  } finally {
    server.restore()
  }
})
