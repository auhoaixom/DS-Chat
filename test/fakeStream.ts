/**
 * 替身流式响应：把全局 fetch 换成一个能手动喂 SSE 事件的假响应。
 *
 * 不用 mock 模块，也不给生产代码加开关 —— `request()` 用的就是全局 fetch，
 * 从这里下手最贴近真实链路（URL 拼接、请求头、SSE 解析、事件派发全都还是真的）。
 */

const encoder = new TextEncoder()

/** 拼一段 SSE 帧；data 走 JSON，和真实服务端一致 */
export const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const startFakeStream = () => {
  const original = globalThis.fetch
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  globalThis.fetch = async () => {
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController
      },
    })
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  return {
    /** 推一段文本增量（前面会自动补上 message_start，让回复真正开始） */
    begin(text: string) {
      controller?.enqueue(
        encoder.encode(
          sse('message_start', {
            type: 'message_start',
            message: { id: 'msg-1', role: 'assistant', usage: { input_tokens: 10, output_tokens: 0 } },
          }),
        ),
      )
      controller?.enqueue(
        encoder.encode(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          }),
        ),
      )
    },
    /** 结束流：客户端会把它当成断流（不是正常结束） */
    end() {
      if (!closed) {
        closed = true
        controller?.close()
      }
    },
    restore() {
      this.end()
      globalThis.fetch = original
    },
  }
}
