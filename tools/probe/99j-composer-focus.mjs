// 输入栏焦点回归：三个按钮不该像以前那样把键盘收走。
//
// 键盘在浏览器里看不到，所以断言的是**成因**：点完之后 document.activeElement 还是不是 textarea。
//   深度思考 / 智能搜索 → 焦点必须留在输入框（拦掉 pointerdown 的默认行为）
//   加号           → 第一次失焦并展开面板；第二次收起面板并把焦点还给输入框
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'))
if (!page) {
  console.error('没有 localhost 页面')
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
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 500))
  }
  return reply.result?.result?.value
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(60)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(300)
}
const boxOf = (selector) =>
  evaluate(`(() => {
    const el = document.querySelector('${selector}')
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })()`)
const state = () =>
  evaluate(`(() => {
    const active = document.activeElement
    const think = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '深度思考')
    const search = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '智能搜索')
    return JSON.stringify({
      focus: active ? active.tagName + (active.tagName === 'TEXTAREA' ? '' : ':' + (active.getAttribute('aria-label') ?? '')) : null,
      thinking: think ? think.getAttribute('aria-pressed') : null,
      search: search ? search.getAttribute('aria-pressed') : null,
      panel: document.body.textContent.includes('拍照') && document.body.textContent.includes('相册'),
    })
  })()`)

await send('Page.enable')
await send('Emulation.clearDeviceMetricsOverride')
await send('Page.reload')
await sleep(2800)
await evaluate(`(async () => {
  // 只在**完全没有** key 时补一个占位值，绝不覆盖已有值：应用会把明文当 key 用并加密写回，
  // 覆盖等于把用户填好的 key 冲成假的（2026-11-28 踩过，压缩一路 401 却报「稍后再试」）。
  if (localStorage.getItem('chat-demo:api-key') === null) {
    localStorage.setItem('chat-demo:api-key', 'probe-key')
  }
  // 1.4.0 起：库里只要有会话、又没写过加密标记，启动会弹一个不可跳过的引导框挡住一切点击。
  // 这个脚本自己不种会话，但临时配置目录是几个探针共用的，别的脚本种下的数据还在。
  await new Promise((resolve) => {
    const request = indexedDB.open('chat-demo')
    request.onerror = () => resolve()
    request.onsuccess = () => {
      const db = request.result
      try {
        db.transaction('meta', 'readwrite').objectStore('meta').put({
          key: 'enc-state', value: { version: 1, sessionsEnc: true, filesEnc: false },
        })
      } catch (error) { /* 老库没有 meta 存储 */ }
      db.close()
      resolve()
    }
  })
  return 'key'
})()`)
await sleep(200)
await send('Page.reload')
await sleep(2600)

// 预热 + 关掉可能弹的设置浮层
await clickAt(900, 400)
if (await evaluate(`document.body.textContent.includes('输入 API Key 开始使用')`)) {
  await clickAt(900, 400)
  await sleep(300)
}

const out = {}
const initial = await state()
out.initial = initial
const textarea = await boxOf('textarea')
if (!textarea) throw new Error('找不到输入框')

// 1. 聚焦输入框
await clickAt(textarea.x, textarea.y)
out.focused = JSON.parse(await state()).focus

// 2. 点「深度思考」：焦点必须还在输入框
const think = await boxOf('button[aria-label="深度思考"]')
await clickAt(think.x, think.y)
out.afterThink = JSON.parse(await state())

// 3. 点「智能搜索」
const search = await boxOf('button[aria-label="智能搜索"]')
await clickAt(search.x, search.y)
out.afterSearch = JSON.parse(await state())

// 4. 点「＋」：应当失焦并展开面板
const plus = await boxOf('button[aria-label^="添加"], button[aria-label*="更多"]')
const attach = plus ?? (await boxOf('button[aria-expanded]'))
await clickAt(attach.x, attach.y)
out.afterPlus = JSON.parse(await state())

// 5. 再点一次：面板收起、焦点回到输入框。
//    必须**重新量按钮位置**：面板展开后布局可能变，用旧坐标会点到面板外面，
//    那一下会被"点外面收起面板"的监听接走，焦点就落到 body 上了（踩过）。
const attachAgain = await boxOf('button[aria-label^="添加"], button[aria-label*="更多"]')
await clickAt(attachAgain.x, attachAgain.y)
out.afterPlusAgain = JSON.parse(await state())
// 焦点可能在下一帧才还回来，再等一会儿复读一次
await sleep(700)
out.afterPlusAgainLater = JSON.parse(await state())

console.log(JSON.stringify(out))
const fail = []
const start = JSON.parse(out.initial)
if (out.focused !== 'TEXTAREA') fail.push(`没能聚焦输入框：${out.focused}`)
if (out.afterThink.focus !== 'TEXTAREA') fail.push(`点深度思考后焦点跑了：${out.afterThink.focus}`)
if (out.afterThink.thinking === start.thinking) fail.push('深度思考没有切换')
if (out.afterSearch.focus !== 'TEXTAREA') fail.push(`点智能搜索后焦点跑了：${out.afterSearch.focus}`)
if (out.afterSearch.search === out.afterThink.search) fail.push('智能搜索没有切换')
if (!out.afterPlus.panel) fail.push('第一次点加号没有展开面板')
if (out.afterPlus.focus === 'TEXTAREA') fail.push('第一次点加号应当失焦（让面板占住键盘位置）')
if (out.afterPlusAgain.panel) fail.push('第二次点加号没有收起面板')
if (out.afterPlusAgainLater.focus !== 'TEXTAREA') fail.push(`第二次点加号焦点没回来：${out.afterPlusAgainLater.focus}`)
console.log(fail.length === 0 ? '判定：全部通过 ✅' : '判定：' + fail.join('；') + ' ❌')
ws.close()
