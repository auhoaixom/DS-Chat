import type {
  AssistantMessage,
  Compaction,
  FileAttachment,
  Message,
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
