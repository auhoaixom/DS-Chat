// 启动画面时间线探针：记录「正在加载对话 / 欢迎页」出现的时间点，
// 用来判断启动画面撤掉的那一刻，屏幕上到底是什么。
//
// 用法（dev 包 + adb forward 之后）：
//   $env:CDP_HOST='127.0.0.1:9333'
//   node tools/probe/splash-timeline.mjs [观察秒数]
//
// 输出形如：
//   [  0ms] other:
//   [312ms] loading
//   [1487ms] welcome      ← 这个时刻要晚于原生的 dismiss 时刻
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const seconds = Number(process.argv[2] ?? 8)

const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}

await new Promise((resolve) => {
  ws.onopen = resolve
})

const recorder = `
(() => {
  window.__tl = []
  const classify = () => {
    const text = document.body ? String(document.body.innerText || '') : ''
    if (text.includes('正在加载')) return 'loading'
    if (text.includes('今天有什么') || text.includes('请输入消息')) return 'welcome'
    if (text.includes('加载失败')) return 'error'
    return 'blank'
  }
  let last = null
  const tick = () => {
    const now = classify()
    if (now !== last) {
      window.__tl.push([Date.now(), now])
      last = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()
`

await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: recorder })
// 立刻重载一次，从文档创建开始观察
await send('Page.reload', { ignoreCache: false })
await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

const result = await send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__tl || [])',
  returnByValue: true,
})
const timeline = JSON.parse(result.result?.result?.value ?? '[]')
const start = timeline.length > 0 ? timeline[0][0] : Date.now()
for (const [at, what] of timeline) {
  console.log(`[${String(at - start).padStart(5)}ms] ${what}`)
}
console.log('first entry wall clock:', start)
ws.close()
