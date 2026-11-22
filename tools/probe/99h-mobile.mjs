// 手机布局下的「查看原文 / 收起原文」回归。
//
// 桌面布局会靠浏览器自带的滚动锚定兜住，测不出这个 bug（实测：把还原逻辑整个停掉，
// 桌面上收起后位置照样对）。手机布局滚动层是另一个元素（.scroll），所以要切到移动仿真再测。
// 打开会话这一步仍在桌面尺寸下做（抽屉里的会话行在移动尺寸下被 transform 到屏幕外），
// 打开之后再切尺寸 —— 切尺寸不会丢 activeId。
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
  await sleep(350)
}

const SCROLLER = `(() => {
  const list = [...document.querySelectorAll('div')].filter(
    (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
  )
  return list.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null
})()`
const TOP_QUESTION = `(() => {
  const sc = ${SCROLLER}
  if (!sc) return null
  const box = sc.getBoundingClientRect()
  return (
    [...document.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /^问题 \\d+$/.test(n.textContent.trim()))
      .map((n) => ({ text: n.textContent.trim(), top: n.getBoundingClientRect().top }))
      .filter((n) => n.top >= box.top - 4)
      .sort((a, b) => a.top - b.top)[0]?.text ?? null
  )
})()`
const STATE = `JSON.stringify({
  scrollTop: ${SCROLLER} ? Math.round(${SCROLLER}.scrollTop) : null,
  top: ${TOP_QUESTION},
  originals: document.body.textContent.includes('以下为已压缩的原文'),
})`
const clickByText = (label) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')
    if (!el) return false
    el.click()
    return true
  })()`)

// 1. 桌面尺寸下把会话打开。数据自己种（和 99d 用同一份），脚本之间不互相依赖；
//    顺手塞一个假 API Key，否则没 key 时应用会自动弹设置浮层挡住会话列表
await evaluate(`(() => { localStorage.setItem('chat-demo:api-key', 'probe-key'); return 'key' })()`)
await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let n = 1; n <= 30; n += 1) {
    messages.push({ id: 'p' + n + 'u', role: 'user', content: '问题 ' + n, files: [], createdAt: now })
    messages.push({
      id: 'p' + n + 'a', role: 'assistant', createdAt: now, model: null, prefix: true,
      status: 'done', blocks: [{ type: 'text', text: '回答 ' + n + '：' + '内容 '.repeat(40) }],
    })
  }
  const session = {
    id: 'probe-originals', title: '原文收起测试', createdAt: now, updatedAt: now,
    messages, schema: 1,
    compaction: {
      summary: '## 摘要\\n旧的对话摘要正文',
      coveredIds: messages.slice(0, 16).map((m) => m.id),
      createdAt: now, mode: 'manual', beforeTokens: 9000, afterTokens: 900, model: null,
    },
  }
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
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  })
  return 'seeded'
})()`)

await send('Page.enable')
await send('Emulation.clearDeviceMetricsOverride')
await send('Page.reload')
await sleep(2800)
await click(900, 400)
const row = await evaluate(`(() => {
  const el = [...document.querySelectorAll('div[class*="item-"]')].find(
    (r) => r.textContent.trim() === '原文收起测试'
  )
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)
for (let attempt = 0; attempt < 4; attempt += 1) {
  await click(row.x, row.y)
  if (await evaluate(`document.body.textContent.includes('上下文已压缩')`)) break
  await sleep(600)
}

// 2. 切到手机布局（会话保持打开）
await send('Emulation.setDeviceMetricsOverride', {
  width: 400, height: 860, deviceScaleFactor: 2, mobile: true,
})
await sleep(1200)

const scrollable = await evaluate(`!!${SCROLLER}`)
if (!scrollable) throw new Error('切换后没找到滚动层')

// 3. 回到最上面，记下展开前的位置。
//    滚到顶部会触发往前补载（loadOlder），补载必须把视口钉住 —— 立刻量与 800ms 后量应当一致
await evaluate(`(() => { ${SCROLLER}.scrollTop = 0; return 'top' })()`)
const topImmediate = JSON.parse(await evaluate(STATE)).top
await sleep(800)
const before = JSON.parse(await evaluate(STATE))
console.log('补载前后视口顶部：', topImmediate, '→', before.top)

// 4. 展开原文
if (!(await clickByText('查看原文'))) throw new Error('找不到「查看原文」')
await sleep(700)
const expanded = JSON.parse(await evaluate(STATE))

// 5. 在原文里往下滑 400px
await evaluate(`(() => { const el = ${SCROLLER}; el.scrollTop = el.scrollTop + 400; return el.scrollTop })()`)
await sleep(600)
const scrolled = JSON.parse(await evaluate(STATE))

// 6. 收起原文
if (!(await clickByText('收起原文'))) throw new Error('找不到「收起原文」')
await sleep(800)
const collapsed = JSON.parse(await evaluate(STATE))

console.log(JSON.stringify({ before, expanded, scrolled, collapsed }))
console.log(
  '判定：',
  collapsed.top === before.top
    ? `收起后视口顶部仍是 ${before.top} ✅`
    : `收起后视口顶部 ${before.top} → ${collapsed.top} ❌（scrollTop ${before.scrollTop} → ${collapsed.scrollTop}）`
)
ws.close()
