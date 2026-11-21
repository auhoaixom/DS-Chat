import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initChat,
  retrySaveSessions,
  selectSession,
  sendMessage,
  useChatStore,
} from '../src/services/chat/store.js'
import { getDraft, useDrafts } from '../src/services/chat/drafts.js'
import { useUploads } from '../src/services/attachments.js'
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

const breakIndexedDbWrites = () => {
  const proto = globalThis.IDBObjectStore?.prototype
  assert.ok(proto, 'fake-indexeddb 没有提供 IDBObjectStore')
  const original = proto.put
  proto.put = function put() {
    throw new Error('模拟：磁盘写满了')
  }
  return () => {
    proto.put = original
  }
}

/**
 * 带附件发消息时，图片原件先进 pendingFiles 再随会话一起落盘。
 * 落盘失败时原件必须留着，重试成功后才释放 —— 否则「重试之后图没了」。
 */
test('落盘失败后图片原件不丢，重试成功才释放', async () => {
  await db.saveSession({
    id: 'a',
    title: '带图的对话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('你好', 'a-m1')],
  })
  await initChat()
  setApiKey('test-key')

  selectSession('a')
  await waitFor(() => Object.hasOwn(useChatStore.getState().sessionCache, 'a'), 'A 读进缓存')

  // 附件上传这一步与本次要测的东西无关，直接把上传任务置成已完成
  const image = new File(['png-bytes'], 'a.png', { type: 'image/png' })
  useDrafts.setState({
    drafts: new Map<string | null, ReturnType<typeof getDraft>>([
      ['a', { text: '看看这张图', attachments: [{ id: 'f1', file: image, isImage: true }] }],
    ]),
  })
  useUploads.setState({ tasks: { f1: { status: 'done', serverId: 'srv-1' } } })

  const stream = startFakeStream()
  const restore = breakIndexedDbWrites()
  try {
    sendMessage('a')
    await waitFor(
      () => useChatStore.getState().sessionSaveErrors.a === true,
      '落盘失败要亮错误',
    )
    // 失败时原件还没进库
    assert.equal(await db.loadFile('f1'), undefined)
  } finally {
    restore()
    stream.begin('好的')
    stream.end()
  }

  retrySaveSessions()
  await waitFor(
    () => useChatStore.getState().sessionSaveErrors.a !== true,
    '重试之后错误要消失',
  )

  const stored = await db.loadFile('f1')
  assert.ok(stored, '重试成功后原件应该已经进库')
  assert.equal(stored.size, image.size)
  stream.restore()
})
