import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTENT_VERSION } from '../src/services/chat/contentVersion.js'
import * as db from '../src/services/chat/db.js'
import { initChat, selectSession, useChatStore } from '../src/services/chat/store.js'
import { compactionRecord, userMessage } from './helpers.js'

/** 轮询到条件成立，避免用固定 sleep 猜 IndexedDB 的时序 */
const waitFor = async (check: () => Promise<boolean> | boolean, label: string) => {
  for (let index = 0; index < 400; index += 1) {
    if (await check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

/**
 * 数据必须在 initChat 之前造好：`initChat` 是一次性的，会话清单只在初始化时读一遍。
 *
 * 这里造的是「版本机制之前」的记录：没有 schema 字段。打开它应当升到当前版本、
 * 标出早期摘要，并且**写回本地**——不写回的话每次打开都要重新迁一遍，迁移逻辑一改
 * 同一份数据就会被解释成两种样子。
 */
test('打开没有版本号的旧记录：升到当前版本并写回本地', async () => {
  await db.saveSession({
    id: 'old',
    title: '旧会话',
    createdAt: 1,
    updatedAt: 1,
    messages: [userMessage('问', 'old-m1')],
    rootMessageId: 'old-m1',
    compaction: compactionRecord({ coveredIds: ['old-m1'], summary: '旧摘要' }),
  })
  await initChat()

  selectSession('old')
  await waitFor(() => useChatStore.getState().sessionCache.old !== undefined, '旧会话读进缓存')

  const cached = useChatStore.getState().sessionCache.old
  assert.equal(cached?.schema, CONTENT_VERSION)
  assert.equal(cached?.compaction?.legacy, true)

  await waitFor(
    async () => (await db.loadSession('old'))?.schema === CONTENT_VERSION,
    '升级后的记录写回本地'
  )
  const stored = await db.loadSession('old')
  // 写回只多了版本号和 legacy 标记：摘要、消息、分支根节点都得原样还在
  assert.equal(stored?.compaction?.summary, '旧摘要')
  assert.equal(stored?.compaction?.legacy, true)
  assert.deepEqual(stored?.messages.map((message) => message.id), ['old-m1'])
  assert.equal(stored?.rootMessageId, 'old-m1')
  assert.equal(stored?.title, '旧会话')
})
