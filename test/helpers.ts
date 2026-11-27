import { readSessionFile } from '../src/services/chat/history/schema.js'
import { toSessionFile } from '../src/services/chat/history/toArchive.js'
import { toLocalSession } from '../src/services/chat/history/toLocal.js'
import type {
  AssistantMessage,
  Compaction,
  FileAttachment,
  Message,
  Session,
  UserMessage,
} from '../src/services/chat/types.js'

let seq = 0
const nextId = () => `m${(seq += 1)}`

export const userMessage = (content: string, id = nextId()): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 0,
})

export const assistantMessage = (text: string, id = nextId()): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 0,
  model: null,
  prefix: true,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

export const imageFile = (id = nextId()): FileAttachment => ({
  id,
  serverId: null,
  name: `${id}.png`,
  size: 1,
  isImage: true,
  mimeType: 'image/png',
})

export const documentFile = (id = nextId()): FileAttachment => ({
  id,
  serverId: null,
  name: `${id}.pdf`,
  size: 1,
  isImage: false,
  mimeType: 'application/pdf',
})

export const compactionRecord = (over: Partial<Compaction> = {}): Compaction => ({
  summary: '摘要正文',
  coveredIds: [],
  createdAt: 0,
  mode: 'auto',
  beforeTokens: 1_000,
  afterTokens: 100,
  model: null,
  ...over,
})

/** 按下标取消息：越界直接报错，避免测试里到处写非空断言 */
export const at = (messages: Message[], index: number): Message => {
  const message = messages[index]
  if (!message) {
    throw new Error(`expected a message at index ${index}`)
  }
  return message
}

/** 一问一答交替的对话，pairs 为轮数（每轮 2 条） */
export const conversation = (pairs: number): Message[] => {
  const messages: Message[] = []
  for (let index = 0; index < pairs; index += 1) {
    messages.push(userMessage(`问题 ${index}`), assistantMessage(`回答 ${index}`))
  }
  return messages
}

/**
 * 「导出 → 导入」往返：会话过一遍真实归档（写出去、再序列化/反序列化读回来），
 * 拿到的就是"从备份导入的会话"——没有本机的锚点、也没有本机的估算口径戳。
 */
export const roundTrip = (session: Session): Session => {
  const file = toSessionFile(session, () => null)
  return toLocalSession(readSessionFile(JSON.parse(JSON.stringify(file)) as never)).session
}

/**
 * 够长的对话：自动压缩（非 aggressive）是按"从末尾往前留够 120K token"挑覆盖段的，
 * 短对话永远挑不出东西（`planCompaction` 返回 null，压缩直接 empty）。
 * 每条约 chars 个汉字 ≈ chars×0.75 token，默认 50 轮 ≈ 15 万 token，
 * 留够 120K 之后前面还剩二十来条可以压。
 *
 * 留着的标记（`问题 0：` / `回答 0：`）用来断言"被压掉的那些确实没进重发的请求"。
 */
export const longConversation = (pairs = 50, chars = 2_000): Message[] => {
  const messages: Message[] = []
  for (let index = 0; index < pairs; index += 1) {
    messages.push(
      userMessage(`问题 ${index}：${'问'.repeat(chars)}`),
      assistantMessage(`回答 ${index}：${'答'.repeat(chars)}`)
    )
  }
  return messages
}
