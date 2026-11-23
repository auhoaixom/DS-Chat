// 思考小窗（v1.1.0）的验收探针。
//
// 用假 SSE 灌一段 600 字的思考，逐 50ms 采样，验证：
//   1) 小窗高度恒为 120px，页面滚动位置在思考阶段不动
//   2) 内层 translateY 单调上升且连续（不是按行跳变）
//   3) 输出停止后收敛到底部并停住
//   4) 展开/收回的两种结束态
// 用法：node tools/probe/99i-thinking.mjs [--expand]
//   --expand：思考中把标题点开且不收回，结束后应保持展开
//   默认  ：不点，结束后应只剩标题行
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const wantExpand = process.argv.includes('--expand')
/**
 * --hold：在思考中途点开标题，检查"视口别再被拽到底部"。
 * 展开会让下方内容一下子长高，如果列表还在贴底跟随，用户点完会直接跳到最新一行 ——
 * 正确的表现是标题行留在原地，页面不再跟随。
 */
const wantHold = process.argv.includes('--hold')
const THINK_CHARS = 600
const CHAR_MS = 40

const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'))
if (!page) {
  console.error('没有 localhost 页面', targets.map((t) => `${t.type} ${t.url}`).join(' | '))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })
  if (reply.result?.exceptionDetails) {
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600))
  }
  return reply.result?.result?.value
}
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(120)
}

// ── 假 SSE：只拦 /messages，其余请求原样放行 ────────────────────────────────
const inject = `(() => {
  const real = window.fetch
  window.__think = { started: false, done: false, chars: 0 }
  const enc = new TextEncoder()
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/messages')) return real(input, init)
    window.__think.started = true
    const sse = (event, data) => enc.encode('event: ' + event + '\\ndata: ' + JSON.stringify(data) + '\\n\\n')
    const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }
    let timer = 0
    let cancelled = false
    const body = new ReadableStream({
      start(c) {
        c.enqueue(sse('message_start', { type: 'message_start', message: { id: 'msg-think', role: 'assistant', usage } }))
        c.enqueue(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
        timer = setInterval(() => {
          if (cancelled) return
          if (window.__think.chars >= ${THINK_CHARS}) {
            clearInterval(timer)
            c.enqueue(sse('content_block_stop', { type: 'content_block_stop', index: 0 }))
            // 真实回复一定会有正文：不给正文，应用会把这一轮当成「已停止」
            c.enqueue(sse('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
            c.enqueue(sse('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '这是正文。' } }))
            c.enqueue(sse('content_block_stop', { type: 'content_block_stop', index: 1 }))
            c.enqueue(sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { ...usage, output_tokens: ${THINK_CHARS} } }))
            c.enqueue(sse('message_stop', { type: 'message_stop' }))
            c.close()
            window.__think.done = true
            return
          }
          window.__think.chars += 1
          c.enqueue(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思' } }))
        }, ${CHAR_MS})
      },
      cancel() { cancelled = true; clearInterval(timer) },
    })
    return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
  }
})()`

await send('Page.enable')
await send('Emulation.clearDeviceMetricsOverride')
await send('Page.addScriptToEvaluateOnNewDocument', { source: inject })
await evaluate(`(() => { localStorage.setItem('chat-demo:api-key', 'probe-key'); return 'key' })()`)
// 种一条够长的会话：页面得真的能滚，"思考时页面不动"这条断言才有意义
await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let n = 1; n <= 20; n += 1) {
    messages.push({ id: 'q' + n + 'u', role: 'user', content: '历史问题 ' + n, files: [], createdAt: now })
    messages.push({
      id: 'q' + n + 'a', role: 'assistant', createdAt: now, model: null, prefix: true,
      status: 'done', blocks: [{ type: 'text', text: '历史回答 ' + n + '：' + '内容 '.repeat(30) }],
    })
  }
  const session = { id: 'probe-thinking', title: '思考小窗测试', createdAt: now, updatedAt: now, messages, schema: 1 }
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-demo')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
      tx.objectStore('sessions').put(session)
      tx.objectStore('sessionSummaries').put({
        id: session.id, title: session.title, createdAt: now, updatedAt: now, fileIds: [],
      })
      tx.oncomplete = () => {
        // 1.4.0 起：库里只要有会话、又没写过加密标记，启动时会弹一个不可跳过的引导框
        // （fixed + z-index 1100），把探针后面每一次点击都吃掉。探针种的是明文记录
        // （读取路径兼容迁移前的形状），所以这里补一个「已完成」的标记，让 boot 直接往下走。
        try {
          db.transaction('meta', 'readwrite').objectStore('meta').put({
            key: 'enc-state', value: { version: 1, sessionsEnc: true, filesEnc: false },
          })
        } catch (error) { /* 老库没有 meta 存储：这个浏览器配置还没跑过 1.4.0+ */ }
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
  return 'seeded'
})()`)
await send('Page.reload')
await sleep(2800)

// 预热 + 关掉可能弹出来的设置浮层
await click(900, 400)
await sleep(500)
if (await evaluate(`document.body.textContent.includes('输入 API Key 开始使用')`)) {
  await click(900, 400)
  await sleep(400)
}

// 打开那条长会话
const sessionRow = await evaluate(`(() => {
  const el = [...document.querySelectorAll('div[class*="item-"]')].find(
    (r) => r.textContent.trim() === '思考小窗测试'
  )
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)
if (!sessionRow) throw new Error('找不到种子会话')
await click(sessionRow.x, sessionRow.y)
await sleep(900)

// 打开「深度思考」开关：否则 message.thinking 为 false，连标题都不会渲染
const thinkToggle = await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '深度思考')
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), pressed: el.getAttribute('aria-pressed') }
})()`)
if (!thinkToggle) throw new Error('找不到深度思考开关')
if (thinkToggle.pressed !== 'true') {
  await click(thinkToggle.x, thinkToggle.y)
  await sleep(300)
}

// 找到输入框，输入并发送
const composer = await evaluate(`(() => {
  const el = document.querySelector('textarea')
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)
if (!composer) throw new Error('找不到输入框')
await click(composer.x, composer.y)
await sleep(300)
await send('Input.insertText', { text: '请详细思考' })
await sleep(300)
const sendBtn = await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '发送')
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)
if (!sendBtn) throw new Error('找不到发送按钮')
await click(sendBtn.x, sendBtn.y)

// 采样器：每 50ms 记一次小窗高度 / 位移 / 页面滚动位置
await evaluate(`(() => {
  window.__samples = []
  window.__sampler = setInterval(() => {
    const inner = document.querySelector('[class*="previewInner"]')
    const box = inner ? inner.parentElement : null
    const scrollers = [...document.querySelectorAll('div')].filter(
      (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
    )
    const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
    let y = null
    if (inner) {
      const m = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(inner).transform)
      y = m ? Number(m[1].split(',')[5]) : 0
    }
    const titleEl = document.querySelector('[class*="titleText"]')
    const titleRow = titleEl ? titleEl.parentElement : null
    window.__samples.push({
      t: Math.round(performance.now()),
      h: box ? Math.round(box.getBoundingClientRect().height) : -1,
      y,
      pageTop: scroller ? Math.round(scroller.scrollTop) : -1,
      titleTop: titleRow ? Math.round(titleRow.getBoundingClientRect().top) : -1,
      mask: box ? getComputedStyle(box).maskImage.slice(0, 24) : '',
      done: !!(window.__think && window.__think.done),
    })
  }, 50)
  return 'sampling'
})()`)

// 等到思考流结束（约 600 × 40ms = 24s，含渲染开销）
let expandedAt = 0
let heldAt = 0
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  if (await evaluate(`window.__think && window.__think.done === true`)) break
  if ((wantExpand || wantHold) && expandedAt === 0 && (await evaluate(`window.__samples.length`)) >= 60) {
    // 展开：点标题行（标题行的实际结构是 图标 + 文本 + 箭头，用文本节点反找父级最稳）
    const title = await evaluate(`(() => {
      const text = document.querySelector('[class*="titleText"]')
      const row = text ? text.parentElement : null
      if (!row) return null
      const b = row.getBoundingClientRect()
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
    })()`)
    if (title) {
      const before = await evaluate(`window.__samples.length`)
      await click(title.x, title.y)
      expandedAt = await evaluate(`window.__samples.length`)
      heldAt = before
    }
  }
  await sleep(250)
}
await sleep(700)

const samples = JSON.parse(await evaluate(`JSON.stringify(window.__samples)`))
const final = JSON.parse(await evaluate(`(() => {
  const inner = document.querySelector('[class*="previewInner"]')
  const box = inner ? inner.parentElement : null
  const titleText = document.querySelector('[class*="titleText"]')
  const titleRow = titleText ? titleText.parentElement : null
  const stepsBox = titleRow ? titleRow.nextElementSibling : null
  const text = titleRow ? titleRow.textContent.trim() : null
  return JSON.stringify({
    preview: !!box,
    height: box ? Math.round(box.getBoundingClientRect().height) : 0,
    title: text,
    stepsHeight: stepsBox ? Math.round(stepsBox.getBoundingClientRect().height) : 0,
    thinkingChars: (document.body.textContent.match(/思/g) || []).length,
  })
})()`))

await evaluate(`clearInterval(window.__sampler)`)

// ── 判定 ────────────────────────────────────────────────────────────────
const previewSamples = samples.filter((s) => s.h >= 0)
const heights = [...new Set(previewSamples.map((s) => s.h))]
const ys = previewSamples.map((s) => s.y).filter((y) => typeof y === 'number')
// translateY 向上滚是越来越负：所以"单调"指的是**非递增**
let monotonic = true
let maxStep = 0
for (let i = 1; i < ys.length; i += 1) {
  if (ys[i] > ys[i - 1] + 0.5) monotonic = false
  maxStep = Math.max(maxStep, Math.abs(ys[i] - ys[i - 1]))
}
// -1 表示当时页面根本不可滚动（内容还短），不算数
const pageTops = [...new Set(previewSamples.map((s) => s.pageTop).filter((v) => v >= 0))]
/**
 * 页面该不该动：小窗从 0 长到 5 行那一下，列表内容确实变高了，
 * 贴底跟随即刻生效 —— 这段位移是**允许**的（上限就是一个窗口高 + 正文几行）。
 * 真正要守的是：窗口长到 120px 之后，思考继续输出时页面必须**一动不动**。
 */
const thinkingSamples = previewSamples.filter((s) => !s.done)
const growIndex = thinkingSamples.findIndex((s) => s.h === 120)
const afterGrow = growIndex >= 0 ? thinkingSamples.slice(growIndex) : []
const scrollDuringThinking =
  afterGrow.length > 1
    ? Math.max(...afterGrow.map((s) => s.pageTop)) - Math.min(...afterGrow.map((s) => s.pageTop))
    : 0
const scrollTotal =
  thinkingSamples.length > 1
    ? Math.max(...thinkingSamples.map((s) => s.pageTop)) -
      Math.min(...thinkingSamples.map((s) => s.pageTop))
    : 0
const tail = ys.slice(-3)
const settled = tail.length === 3 && Math.abs(tail[2] - tail[0]) < 0.01
const report = {
  mode: wantHold ? 'hold' : wantExpand ? 'expand' : 'default',
  previewSamples: previewSamples.length,
  heights,
  maxHeight: Math.max(...heights),
  monotonic,
  maxStep: Math.round(maxStep * 10) / 10,
  lastY: Math.round(ys.at(-1) ?? -1),
  settled,
  pageTops,
  scrollTotal,
  scrollAfterGrow: scrollDuringThinking,
  maskSample: previewSamples.at(-1)?.mask ?? '',
  final,
}

/**
 * --hold：点击展开之后，标题行必须留在原地、页面不许再跟随。
 * 取点击前一个采样与点击后两个采样比。
 */
if (wantHold && heldAt > 0) {
  const before = samples[heldAt - 1]
  const after = samples.slice(heldAt + 1, heldAt + 4).filter((s) => s.titleTop >= 0)
  const titleDrift = before && after.length > 0 ? Math.abs(after[0].titleTop - before.titleTop) : -1
  const postClick = samples.filter((s, i) => i > heldAt + 1 && !s.done && s.pageTop >= 0)
  const postScroll =
    postClick.length > 1
      ? Math.max(...postClick.map((s) => s.pageTop)) - Math.min(...postClick.map((s) => s.pageTop))
      : 0
  report.titleDrift = titleDrift
  report.postClickScroll = postScroll
}
console.log(JSON.stringify(report))

const fail = []
if (previewSamples.length < 10) fail.push('小窗几乎没被采样到（是不是没进小窗态）')
if (!heights.every((h) => h <= 120)) fail.push(`出现了超过 120 的高度：${heights.join(',')}`)
if (!monotonic) fail.push('位移出现了回退（应该一路向上）')
if (!settled) fail.push('输出停止后位移没有收敛')
if (!report.maskSample) fail.push('没有 mask-image')
if (!wantExpand && !wantHold) {
  // 只有一直待在小窗态跑完全程，窗口才会被内容顶到 5 行上限
  if (report.maxHeight !== 120) fail.push(`窗口最大高度应为 120，实际 ${report.maxHeight}`)
  if (maxStep > 40) fail.push(`相邻采样步长过大（${maxStep}px），像是按行跳变`)
  // 窗口长满之后思考继续输出，页面必须停住；整段允许的位移只有一个窗口高 + 正文
  if (scrollDuringThinking > 1) fail.push(`窗口长满后页面仍在动：${scrollDuringThinking}px`)
  if (scrollTotal > 220) fail.push(`思考阶段页面位移过大：${scrollTotal}px`)
}
if (wantExpand) {
  if (final.preview) fail.push('结束后不应再是小窗')
  // 展开态结束时思考全文仍在页面上：步骤区高度必然超过 120
  if (final.stepsHeight <= 120) fail.push(`展开态结束后步骤区应高于 120，实际 ${final.stepsHeight}`)
  if (expandedAt === 0) fail.push('没能在流中点到标题行（展开动作没发生）')
} else if (wantHold) {
  if (expandedAt === 0) fail.push('没能在流中点到标题行（展开动作没发生）')
  if (!(report.titleDrift >= 0 && report.titleDrift <= 6)) {
    fail.push(`展开后标题行被挪走了 ${report.titleDrift}px（应留在原地）`)
  }
  if (report.postClickScroll > 2) {
    fail.push(`展开后页面仍在跟随滚动：${report.postClickScroll}px`)
  }
} else {
  if (final.preview) fail.push('结束后小窗应收起')
  if (!final.title || !final.title.startsWith('已思考')) fail.push(`结束后标题行不对：${final.title}`)
}
console.log(fail.length === 0 ? '判定：全部通过 ✅' : '判定：' + fail.join('；') + ' ❌')
ws.close()
