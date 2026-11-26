// 在页面里跑一段表达式，结果按 JSON 打出来。表达式从文件读，避免在命令行里跟引号打架：
//   node tools/probe/eval.mjs expr.js
// 需要：adb forward tcp:9444 localabstract:webview_devtools_remote_<pid>，CDP_HOST=localhost:9444
import fs from 'node:fs'

const host = process.env.CDP_HOST || 'localhost:9444'
const file = process.argv[2]
if (!file) {
  throw new Error('用法：node tools/probe/eval.mjs <表达式文件>')
}
const expression = fs.readFileSync(file, 'utf8')

const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
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
await send('Runtime.enable')
const r = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
})
if (r.result?.exceptionDetails) {
  console.error(JSON.stringify(r.result.exceptionDetails).slice(0, 600))
  process.exitCode = 1
}
console.log(JSON.stringify(r.result?.result?.value ?? null, null, 2))
ws.close()
