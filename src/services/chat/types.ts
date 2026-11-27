import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

/**
 * 一次请求的花费记录。写在消息上，只有「我们 App 自己发出的请求」才有：
 * 导入的会话、旧版本留下的消息都没有这个字段，界面因此不显示任何金额。
 * 单价随记录快照一起存，改价不会改写历史。
 */
export type RequestCost = {
  /** 请求发起时刻（毫秒）；峰谷按它判定，不由结束时决定 */
  at: number
  /** 这次请求是否按峰价 */
  peak: boolean
  /** 实际计价用的模型名（服务端回报的优先） */
  model: string
  /** 未命中输入的 token（不含缓存写入） */
  input: number
  cacheRead: number
  /** 缓存写入的 token，按未命中价计 */
  cacheWrite: number
  output: number
  /** 单价快照，纳元 / token */
  rates: { miss: number; hit: number; write: number; out: number }
  /** 这次请求的成本，纳元 */
  nano: number
}

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 服务端实际回报的模型名（别名可能解析到别的模型），只用于展示与容量查表 */
  servedModel?: string
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  /**
   * 已发生的收费请求，按时间顺序追加。续写与断线自动续写各算一次，
   * 所以一条消息可能有多笔；界面显示的是它们的合计。
   */
  costs?: RequestCost[]
  /** 发出这次请求时的提示侧估算（token），用于按"表面净增减"推算当前上下文占用 */
  promptEstimate?: number
  /**
   * 写 `promptEstimate` 时用的估算口径版本（见 tokens.ts 的 `ESTIMATE_VERSION`）。
   * 版本对不上，这个估算值就不能拿来当锚点的基准；缺省表示口径版本之前写下的。
   */
  estimateVersion?: number
  /**
   * 发出这次请求时的请求形状（模型 / 思考 / 联网 / 有无附件 / 提示词与口径版本），
   * 见 compaction.ts 的 `requestKeyOf`。形状变了，这次回报的 usage 就不能当基准。
   * 本机口径，不进导出包。
   */
  requestKey?: string
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

/**
 * 上下文压缩：当前分支开头的一段消息不再进入请求，改用这份摘要代替。
 * 原始消息仍然保存在会话里，撤销这条记录即可完全恢复。
 */
export type Compaction = {
  /** 摘要正文（Markdown），作为请求的系统信息附加在对话之前 */
  summary: string
  /** 被摘要覆盖的消息 ID，按原顺序；请求里只有它们形成的开头连续前缀会被替换 */
  coveredIds: string[]
  createdAt: number
  /** manual：用户点按；auto：发送前按阈值或超限时自动触发 */
  mode: 'manual' | 'auto'
  /** 这次压缩替换掉的东西的 token 估算：被吞掉的原文，合并时再加上旧摘要 */
  beforeTokens: number
  /** 新摘要自身的 token 估算；与 beforeTokens 同一套口径 */
  afterTokens: number
  model: string | null
  /** 摘要请求自身的用量，用于核对是否吃到了前缀缓存（诊断用） */
  summaryUsage?: { input: number; cacheRead: number; cacheWrite: number }
  /** 摘要请求是否走了「回放历史」的模式 */
  viaReplay?: boolean
  /**
   * 由早期版本写入、本机无法重算的记录：只在读库升级时标上（见 contentVersion.ts），
   * 用来解释为什么这里的分数字可能和当前口径对不上。
   */
  legacy?: boolean
  /**
   * 压缩发生那一刻正在生效的锚点（那条回复的 id）。
   * 撤销压缩时把它交给 `Session.anchorId`，面板才会用"压缩前"的实测当基准，
   * 而不是用压缩后那次小请求——后者算出来的数是拼接口径（26% 就是这么来的）。
   */
  anchorId?: string
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  /** 当前的上下文压缩；缺省表示没有压缩过 */
  compaction?: Compaction
  /** 置顶在会话列表顶部；本地偏好，不进导出包，导入的会话一律不置顶 */
  pinned?: boolean
  /**
   * 写入时程序使用的持久化内容版本（见 contentVersion.ts）；缺省表示版本机制之前的记录。
   * 与 IndexedDB 的结构版本无关，别拿它当 DB_VERSION 用。
   */
  schema?: number
  /**
   * 不属于任何一条回复的请求开销（目前是压缩摘要用的那些请求）。
   * 钱真花了，但挂在某条回答头上是错的，所以只进会话合计、不单独显示。
   * 撤销压缩也不会退还，所以这份记录只增不减。
   */
  extraCosts?: RequestCost[]
  /**
   * 撤销压缩后强制使用的锚点（那条回复的 id），来自被撤销记录的 `Compaction.anchorId`。
   * 只在"压缩后又聊了几轮再撤销"这种情形下才有意义：最近一条回复是压缩后的小请求，
   * 拿它当基准会把真实用量算低。新的回复带来实测之后自动清掉。
   * 本机口径，不进导出包。
   */
  anchorId?: string
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<
  Session,
  'id' | 'title' | 'createdAt' | 'updatedAt' | 'pinned'
>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  pinned: session.pinned,
})
