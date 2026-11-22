// 长按菜单的回归：contextmenu 只开不关、正常点击照旧、点外面能关、菜单项能点
// 行元素按 CSS module 的 class 前缀找（`item-xxxxx`），不能按文字找——会话标题在聊天页头部也会出现
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'))
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

const ROW = `[...document.querySelectorAll('div[class*="item-"]')].find(
  (el) => el.textContent.trim() === '长按测试会话'
)`

await send('Page.enable')
// 上一个脚本可能把视口留在移动仿真上，这里明确回到桌面尺寸
await send('Emulation.clearDeviceMetricsOverride')
await send('Page.reload')
await sleep(2600)

const rowBox = () =>
  evaluate(`(() => {
    const row = ${ROW}
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
const menuState = () => evaluate(`document.querySelector('[role="menu"]') ? 'open' : 'closed'`)
const click = async (x, y, hold = 60) => {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(hold)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(350)
}

const out = {}
let box = await rowBox()
out.rowFound = !!box
// 预热（首次输入会被取焦点吃掉），顺带把可能开着的菜单收掉
await click(box.x, box.y)
if ((await menuState()) === 'open') {
  await click(600, 600)
}
box = await rowBox()

// A. 长按 800ms：松手后菜单必须还开着
await click(box.x, box.y, 800)
out.a_heldOpen = await menuState()

// B. 菜单开着时，系统再补发两次 contextmenu：不能关
out.b_contextMenuTwice = await evaluate(`(() => {
  const row = ${ROW}
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  return document.querySelector('[role="menu"]') ? 'open' : 'closed'
})()`)

// C. 菜单开着时正常点这一行 = 收起菜单
await click(box.x, box.y)
out.c_tapToClose = await menuState()

// D. 重新长按打开，然后点外面 = 收起
await click(box.x, box.y, 800)
out.d_reopened = await menuState()
await click(600, 600)
out.d_outsideClose = await menuState()

// E. 菜单项能点：点第一项（置顶），菜单应关闭
await click(box.x, box.y, 800)
const itemBox = await evaluate(`(() => {
  const el = document.querySelector('[role="menuitem"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`)
out.e_menuItemFound = !!itemBox
if (itemBox) {
  await click(itemBox.x, itemBox.y)
}
out.e_afterSelect = await menuState()
out.e_alive = await evaluate(`!!document.querySelector('#root').children.length`)

console.log(JSON.stringify(out))
ws.close()
