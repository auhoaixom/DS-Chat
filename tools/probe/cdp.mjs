// 通用 CDP 执行器：node cdp.mjs <snippet.js>
// 连到已 forward 的 WebView 页面，执行 snippet（顶层可用 await），打印返回值
import fs from 'node:fs'

const host = process.env.CDP_HOST || '127.0.0.1:9333'
const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target')
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

const code = fs.readFileSync(process.argv[2], 'utf8')
const reply = await send('Runtime.evaluate', {
  expression: code,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
  timeout: 120000,
})

if (reply.error) {
  console.log(JSON.stringify({ cdpError: reply.error }, null, 2))
} else if (reply.result?.exceptionDetails) {
  const details = reply.result.exceptionDetails
  console.log(
    JSON.stringify(
      { exception: details.text, desc: details.exception?.description, line: details.lineNumber },
      null,
      2,
    ),
  )
} else {
  console.log(JSON.stringify(reply.result?.result?.value ?? null, null, 2))
}
ws.close()
