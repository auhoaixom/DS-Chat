// 读顶栏上下文用量：百分比、面板四行、锚点标签；可选点击面板开关
//   node tools/probe/meter.mjs            # 只读顶栏
//   node tools/probe/meter.mjs --open     # 点开面板再读
// 需要：adb forward tcp:9444 localabstract:webview_devtools_remote_<pid>，CDP_HOST=localhost:9444
const host = process.env.CDP_HOST || 'localhost:9444'
const open = process.argv.includes('--open')

const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) {
  throw new Error('没有找到 webview 页面')
}
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  }
  return r.result?.result?.value
}

await send('Runtime.enable')

const findMeter = `(() => {
  const button = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((item) =>
    /\\d+%|<1%/.test(item.getAttribute('aria-label') || '')
  )
  return button || null
})()`

if (open) {
  await ev(`(() => { const b = ${findMeter}; if (b) b.click(); return !!b })()`)
  await new Promise((r) => setTimeout(r, 400))
}

const result = await ev(`(() => {
  const b = ${findMeter}
  const trigger = b ? (b.innerText || '').trim() : null
  const panel = document.querySelector('[role="dialog"][aria-label]')
  const rows = panel
    ? [...panel.querySelectorAll('dt')].map((dt) => ({
        label: dt.textContent.trim(),
        value: dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : null,
      }))
    : null
  const figures = panel ? [...panel.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean) : null
  return {
    trigger,
    aria: b ? b.getAttribute('aria-label') : null,
    rows,
    figures,
    title: document.querySelector('header')?.innerText?.split('\\n')[0] ?? null,
  }
})()`)

console.log(JSON.stringify(result, null, 2))
ws.close()
