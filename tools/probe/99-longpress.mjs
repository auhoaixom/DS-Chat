// 长按弹菜单的桌面复现：控制按下 / 保持 / 松手的时机，看菜单是被"一闪而过"还是留着。
// 用法：node 99-longpress.mjs <holdMs>
// 需要：pnpm dev 起着（127.0.0.1:8090）、Edge 开了 --remote-debugging-port=9333
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const holdMs = Number(process.argv[2] ?? 1000)

const targets = await (await fetch(`http://${host}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'))
if (!page) {
  console.error('no page target', targets.map((t) => `${t.type} ${t.url}`))
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
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (reply.result?.exceptionDetails) {
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400))
  }
  return reply.result?.result?.value
}

await send('Page.enable')
// 上一个脚本可能把视口留在移动仿真上，这里明确回到桌面尺寸
await send('Emulation.clearDeviceMetricsOverride')
await send('Runtime.enable')

// 1. 造一条会话（列表里得有东西可长按）
await evaluate(`(async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('chat-demo')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
      const now = Date.now()
      tx.objectStore('sessions').put({
        id: 'probe-longpress', title: '长按测试会话', createdAt: now, updatedAt: now,
        messages: [], rootMessageId: null, schema: 1,
      })
      tx.objectStore('sessionSummaries').put({
        id: 'probe-longpress', title: '长按测试会话', createdAt: now, updatedAt: now, fileIds: [],
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
await sleep(2500)

// 2. 找到那一行
const box = await evaluate(`(() => {
  const leaf = [...document.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && el.textContent.trim() === '长按测试会话'
  )
  if (!leaf) return null
  const row = leaf.parentElement
  const r = row.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`)
if (!box) {
  console.error('没找到会话行')
  process.exit(1)
}

const menuState = () => evaluate(`document.querySelector('[role="menu"]') ? 'open' : 'closed'`)

const mouse = (type, extra) =>
  send('Input.dispatchMouseEvent', {
    type,
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
    pointerType: 'mouse',
    ...extra,
  })

// 3. 预热：刚 reload 完的第一下输入会被页面取焦点吃掉，不能算进测量
await mouse('mousePressed', { buttons: 1 })
await sleep(60)
await mouse('mouseReleased', { buttons: 0 })
await sleep(600)
const afterWarmup = await menuState()

// 4. 按下 → 保持 holdMs → 松手，全程盯菜单
await mouse('mousePressed', { buttons: 1 })
await sleep(700)
const openedWhileHeld = await menuState()
await sleep(Math.max(0, holdMs - 700))
await mouse('mouseReleased', { buttons: 0 })
await sleep(400)
const afterRelease = await menuState()

console.log(JSON.stringify({ holdMs, row: box, afterWarmup, openedWhileHeld, afterRelease }))
ws.close()
