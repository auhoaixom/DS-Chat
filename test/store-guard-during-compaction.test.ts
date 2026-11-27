import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import {
  cancelCompaction,
  compactSession,
  editMessage,
  initChat,
  selectMessageVersion,
  selectSession,
  useChatStore,
} from '../src/services/chat/store.js'
import { setApiKey } from '../src/services/settings.js'
import { assistantMessage, userMessage } from './helpers.js'
import { isSummaryCall, startScriptedFetch } from './scriptedFetch.js'

/**
 * 压缩**正在进行中**时也不许改路径。
 *
 * 那十几秒里边界还没定：摘要已经按"现在的路径"取好原文发出去，记录要等请求回来才写。
 * 此刻改一条消息（编辑/切版本），写出来的覆盖段就会和摘要对不上——
 * 和"压缩完之后再改"是同一个错，只是更难复现。
 *
 * 界面那边按钮已经变灰，但按钮会不会真的灰是渲染的事；这里守的是入口本身：
 * `compactSession` 一进门就同步登记了 controller，所以这个判断比按钮可靠。
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

test('压缩进行中：编辑和切版本都被拒绝，压缩本身照常继续', async () => {
  await db.saveSession({
    id: 'a',
    title: '压缩中不许动',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { ...userMessage('第一问', 'u1'), parentId: null, selectedChildId: 'a1' },
      { ...assistantMessage('第一答', 'a1'), parentId: 'u1', selectedChildId: 'u2' },
      { ...userMessage('第二问', 'u2'), parentId: 'a1', selectedChildId: 'a2' },
      { ...assistantMessage('第二答', 'a2'), parentId: 'u2', selectedChildId: 'u3' },
      { ...userMessage('第三问', 'u3'), parentId: 'a2', selectedChildId: 'a3' },
      // 保留段里的另一个版本：压缩结束后切它是合法的，压缩进行中不行
      { ...assistantMessage('第三答', 'a3'), parentId: 'u3' },
      { ...assistantMessage('第三答（另一版）', 'a3b'), parentId: 'u3' },
    ],
  })
  await initChat()
  setApiKey('test-key')
  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  const server = startScriptedFetch((call) =>
    isSummaryCall(call) ? { kind: 'hang' } : { kind: 'text' }
  )
  let running: Promise<unknown> | undefined
  try {
    running = compactSession('a')
    await waitFor(() => Object.hasOwn(useChatStore.getState().compacting, 'a'), '压缩已经开始')
    assert.equal(server.summaryCalls().length, 1, '前提：摘要请求已经在路上')

    const before = useChatStore.getState().sessionCache.a?.messages.length ?? 0
    // 这条提问马上就会被压进覆盖段
    assert.equal(editMessage('a', 'u1', '加压中改的'), false, '压缩进行中不许编辑')
    assert.equal(useChatStore.getState().sessionCache.a?.messages.length, before, '不许留下新分支')

    selectMessageVersion('a', 'a3b')
    assert.equal(
      useChatStore.getState().sessionCache.a?.messages.find((message) => message.id === 'u3')
        ?.selectedChildId,
      'a3',
      '压缩进行中不许切版本'
    )
  } finally {
    cancelCompaction('a')
    await running?.catch(() => undefined)
  }

  try {
    // 压缩被取消，没有留下记录；此时再编辑就放行了（说明拦的是"进行中"这个状态本身）
    assert.equal(useChatStore.getState().sessionCache.a?.compaction, undefined)
    assert.equal(editMessage('a', 'u1', '取消之后可以改'), true)
    await waitFor(() => useChatStore.getState().streaming.a === undefined, '对照用的流结束')
  } finally {
    server.restore()
  }
})
