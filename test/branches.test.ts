import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendBranch,
  buildMessageVersions,
  getVisibleMessages,
  normalizeSession,
  selectVersion,
} from '../src/services/chat/branches.js'
import type { Message, Session } from '../src/services/chat/types.js'
import { assistantMessage, at, userMessage } from './helpers.js'

const sessionOf = (messages: Message[], rootMessageId?: string | null): Session => ({
  id: 's1',
  title: '分支测试',
  createdAt: 0,
  updatedAt: 0,
  messages,
  ...(rootMessageId === undefined ? {} : { rootMessageId }),
})

test('线性会话被规范成单分支：补上 parentId 与选中关系', () => {
  const [u, a] = conversation2()
  const normalized = normalizeSession(sessionOf([u, a]))

  assert.equal(normalized.rootMessageId, u.id)
  assert.equal(at(normalized.messages, 0).parentId, null)
  assert.equal(at(normalized.messages, 0).selectedChildId, a.id)
  assert.equal(at(normalized.messages, 1).parentId, u.id)
  assert.equal(at(normalized.messages, 1).selectedChildId, undefined)
})

test('已经是分支结构时不再改写', () => {
  const [u, a] = conversation2()
  const session = sessionOf(
    [
      { ...u, parentId: null, selectedChildId: a.id },
      { ...a, parentId: u.id },
    ],
    u.id
  )
  assert.equal(normalizeSession(session), session)
})

test('可见消息沿选中关系走一条路径，不再按存储顺序', () => {
  // u → 两个版本 a1 / a2；当前选 a1，其后还有 a1 的后续
  const u = userMessage('问')
  const a1 = assistantMessage('答一')
  const a2 = assistantMessage('答二')
  const follow = userMessage('追问')
  const session = sessionOf(
    [
      { ...u, parentId: null, selectedChildId: a1.id },
      { ...a1, parentId: u.id, selectedChildId: follow.id },
      { ...a2, parentId: u.id },
      { ...follow, parentId: a1.id },
    ],
    u.id
  )

  assert.deepEqual(
    getVisibleMessages(session).map((message) => message.id),
    [u.id, a1.id, follow.id]
  )
})

test('选中链断掉时就停在断点，不越过缺失的消息', () => {
  const u = userMessage('问')
  const session = sessionOf([{ ...u, parentId: null, selectedChildId: 'missing' }], u.id)
  assert.deepEqual(
    getVisibleMessages(session).map((message) => message.id),
    [u.id]
  )
})

test('没有 rootMessageId 时按线性列表返回全部', () => {
  const [u, a] = conversation2()
  assert.equal(getVisibleMessages(sessionOf([u, a])).length, 2)
})

test('兄弟版本分组，未变化时复用同一批对象', () => {
  const u = userMessage('问')
  const a1 = assistantMessage('答一')
  const a2 = assistantMessage('答二')
  const session = sessionOf(
    [
      { ...u, parentId: null, selectedChildId: a1.id },
      { ...a1, parentId: u.id },
      { ...a2, parentId: u.id },
    ],
    u.id
  )

  const first = buildMessageVersions(session, new Map())
  assert.deepEqual(first.get(a1.id)?.ids, [a1.id, a2.id])
  assert.equal(first.get(a1.id)?.index, 0)
  assert.equal(first.get(a2.id)?.index, 1)

  // 内容没变：直接复用上一次的结果，避免流式更新重绘历史
  assert.equal(buildMessageVersions(session, first), first)

  // 新加一个兄弟后必须重建
  const a3 = assistantMessage('答三')
  const grown = sessionOf([...session.messages, { ...a3, parentId: u.id }], u.id)
  const second = buildMessageVersions(grown, first)
  assert.notEqual(second, first)
  assert.equal(second.get(a3.id)?.ids.length, 3)
})

test('追加分支挂在指定父节点下，并选中新分支', () => {
  const [u, a] = conversation2()
  const session = sessionOf([u, a])
  const next = appendBranch(session, u.id, [assistantMessage('新答')])

  const parent = next.messages.find((message) => message.id === u.id)
  const added = next.messages.at(-1)
  assert.ok(parent && added)
  assert.equal(parent.selectedChildId, added.id)
  assert.equal(added.parentId, u.id)

  // 原分支还在，没有被删掉
  assert.ok(next.messages.some((message) => message.id === a.id))
})

test('在空会话上追加时，新消息成为根', () => {
  const session = sessionOf([])
  const fresh = userMessage('第一句')
  const next = appendBranch(session, null, [fresh])
  assert.equal(next.rootMessageId, fresh.id)
})

test('只能切到当前路径上的兄弟版本', () => {
  const u = userMessage('问')
  const a1 = assistantMessage('答一')
  const a2 = assistantMessage('答二')
  const session = sessionOf(
    [
      { ...u, parentId: null, selectedChildId: a1.id },
      { ...a1, parentId: u.id },
      { ...a2, parentId: u.id },
    ],
    u.id
  )

  const switched = selectVersion(session, a2.id)
  assert.equal(switched.messages.find((message) => message.id === u.id)?.selectedChildId, a2.id)

  // 不存在的消息原样返回
  assert.equal(selectVersion(session, 'nope'), session)
})

/** 两段最简对话：一问一答 */
function conversation2(): [Message, Message] {
  return [userMessage('问'), assistantMessage('答')]
}
