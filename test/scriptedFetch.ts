import { sse } from './fakeStream.js'

/**
 * 可编排的假服务端：按调用顺序（或按请求内容）决定这一次返回什么。
 *
 * 为什么不用 `fakeStream`：那套只支持"一条流、手动喂事件"，用来测单次回复刚好，
 * 但压缩相关的路径一次发送里会打出好几个请求（聊天 → 摘要 → 再聊天），
 * 还要让第一枪以「超限」失败。这里每一枪都能单独指定，并把请求体原样记下来，
 * 断言"第二次请求里带的是摘要、被压掉的消息确实不在里面"要靠它。
 */

export type RecordedCall = { url: string; body: Record<string, unknown> }

export type ScriptReply =
  /** 服务端判超限：400 + 长度相关报文 */
  | { kind: 'overflow'; status?: number; message?: string }
  /** 其它失败（摘要请求 500 之类） */
  | { kind: 'error'; status: number; message: string }
  /** 正常把一段文本吐完 */
  | { kind: 'text'; text?: string; usage?: Partial<Usage> }
  /** 挂住不结束，用来造"请求进行中"；中止信号到达时以 AbortError 结束 */
  | { kind: 'hang' }

export type Usage = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

type Message = { role?: string; content?: unknown }
type Body = { system?: unknown; messages?: Message[] }

const encoder = new TextEncoder()

/** 摘要请求：三种形态（回放 / 分段 / 合并）各自的系统提示词都不带聊天那套 */
export const isSummaryCall = (call: RecordedCall): boolean => {
  const body = call.body as Body
  const system = String(body.system ?? '')
  const last = body.messages?.[body.messages.length - 1]
  const lastText = typeof last?.content === 'string' ? last.content : ''
  return (
    system.includes('对话压缩器') ||
    system.includes('聊天记录压缩器') ||
    lastText.includes('只做一件事') ||
    lastText.includes('分段要点')
  )
}

/** 这一枪请求里带的消息条数（摘要的覆盖范围靠它比较） */
export const messageCountOf = (call: RecordedCall): number =>
  (call.body as Body).messages?.length ?? 0

const framesOf = (text: string, usage: Usage): string =>
  sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg',
      role: 'assistant',
      usage: { input_tokens: usage.input, output_tokens: 0 },
    },
  }) +
  sse('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }) +
  sse('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  }) +
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }) +
  sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: {
      input_tokens: usage.input,
      cache_creation_input_tokens: usage.cacheWrite,
      cache_read_input_tokens: usage.cacheRead,
      output_tokens: usage.output,
    },
  }) +
  sse('message_stop', { type: 'message_stop' })

export const startScriptedFetch = (
  policy: (call: RecordedCall, index: number) => ScriptReply = () => ({ kind: 'text' })
) => {
  const original = globalThis.fetch
  const calls: RecordedCall[] = []
  const hung: ReadableStreamDefaultController<Uint8Array>[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : ''
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }
    const call: RecordedCall = { url: String(input), body }
    calls.push(call)
    const reply = policy(call, calls.length - 1)

    if (reply.kind === 'overflow' || reply.kind === 'error') {
      const message =
        reply.kind === 'overflow'
          ? (reply.message ?? 'prompt is too long: 1200000 tokens > 1048576')
          : reply.message
      const status = reply.kind === 'overflow' ? (reply.status ?? 400) : reply.status
      return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (reply.kind === 'hang') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          hung.push(controller)
          init.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('aborted', 'AbortError'))
            } catch {
              // 流已经被关掉了
            }
          })
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    const usage: Usage = {
      input: 900,
      cacheRead: 0,
      cacheWrite: 0,
      output: 12,
      ...reply.usage,
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(framesOf(reply.text ?? '好的。', usage)))
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  return {
    calls,
    /** 摘要请求那几枪（回放 / 分段 / 合并都算） */
    summaryCalls: () => calls.filter(isSummaryCall),
    /** 真正的聊天请求（含失败与重发） */
    chatCalls: () => calls.filter((call) => !isSummaryCall(call)),
    hung,
    restore() {
      globalThis.fetch = original
    },
  }
}
