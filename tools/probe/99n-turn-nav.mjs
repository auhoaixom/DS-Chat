// 右侧「对话目录」回归：滑出、行数、当前轮高亮、点一条跳过去、展开更早同步变长。
//
// 只有在移动布局下才会挂载（桌面不挂），所以整个流程在手机的移动布局里跑；
// 尺寸用设备自己的（360×770），不模拟桌面——真机上"桌面布局"根本不存在。
//
// 前置：-dev 包 + `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`，
// 然后 `node tools/probe/99n-turn-nav.mjs`。
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const targets = await (await fetch(`http://${host}/json/list`)).json()
// Capacitor 的页面 origin 是 https://localhost（file:// 的 null origin 会让 IndexedDB 失效），
// 所以这里按域名匹配，不写死协议。
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost'))
if (!page) throw new Error('没找到 WebView 页面，先确认 adb forward 指到了 webview_devtools_remote')
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

/** 视口顶部那一条提问（判定"跳到哪儿了"的固定口径，见 STANDARDS 规矩 7）
 *  只认消息区里的提问：右侧目录自己的行也写着「问题 N」，它常驻挂载、只是被平移出屏幕，
 *  不排掉的话量到的永远是目录的第一行。 */
const TOP_QUESTION = `(() => {
  const list = [...document.querySelectorAll('div')].filter(
    (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
  )
  const sc = list.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  if (!sc) return null
  const box = sc.getBoundingClientRect()
  return (
    [...document.querySelectorAll('*')]
      .filter(
        (n) =>
          n.children.length === 0 &&
          /^问题 \\d+$/.test(n.textContent.trim()) &&
          n.closest('[data-turn-id]') !== null
      )
      .map((n) => ({ text: n.textContent.trim(), top: n.getBoundingClientRect().top }))
      .filter((n) => n.top >= box.top - 4)
      .sort((a, b) => a.top - b.top)[0]?.text ?? null
  )
})()`

/**
 * 抽屉状态。目录的行是常驻挂载的（收起时整块被 translate 到屏幕外，
 * 和左抽屉同一套做法），所以"开着没有"只能看那些行的水平位置，不能看有没有渲染。
 */
const NAV_STATE = `JSON.stringify((() => {
  const rows = [...document.querySelectorAll('button')].filter(
    (b) => /^问题 \\d+$/.test(b.textContent.trim())
  )
  const first = rows[0]
  const box = first ? first.getBoundingClientRect() : null
  return {
    open: box ? box.left >= 0 && box.left < window.innerWidth - 1 : false,
    rows: rows.map((b) => b.textContent.trim()),
    active: rows.find((b) => b.getAttribute('aria-current') === 'true')?.textContent.trim() ?? null,
    expander: [...document.querySelectorAll('button')]
      .map((b) => b.textContent.trim())
      .find((text) => text.startsWith('展开更早的')) ?? null,
    hint: document.body.textContent.includes('压缩过的对话不支持定位'),
  }
})())`

const clickText = (label) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('${label}'))
    if (!el) return false
    el.click()
    return true
  })()`)

/** 一次从右往左的横滑（在视口中线上，避开输入框与底部安全区） */
const swipeLeft = async (y) => {
  const fromX = innerWidthFallback - 20
  const toX = 40
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  const steps = 12
  for (let step = 1; step <= steps; step += 1) {
    const x = fromX + ((toX - fromX) * step) / steps
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await sleep(16)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(450)
}

// 1. 种数据（30 轮），重载后从侧栏点开这条会话
// 只在**完全没有** key 时补一个占位值，绝不覆盖已有值：应用把明文当 key 用并加密写回，
// 覆盖等于把用户填好的 key 冲成假的（2026-11-28 踩过：压缩一路 401 却报「稍后再试」）。
await evaluate(`(() => {
  if (localStorage.getItem('chat-demo:api-key') === null) localStorage.setItem('chat-demo:api-key', 'probe-key')
  return 'key'
})()`)
await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let n = 1; n <= 30; n += 1) {
    messages.push({ id: 'n' + n + 'u', role: 'user', content: '问题 ' + n, files: [], createdAt: now })
    messages.push({
      id: 'n' + n + 'a', role: 'assistant', createdAt: now, model: null, prefix: true,
      status: 'done', blocks: [{ type: 'text', text: '回答 ' + n + '：' + '内容 '.repeat(40) }],
    })
  }
  const session = {
    id: 'probe-turn-nav', title: '目录测试', createdAt: now, updatedAt: now, messages, schema: 1,
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
      tx.oncomplete = () => {
        try {
          db.transaction('meta', 'readwrite').objectStore('meta').put({
            key: 'enc-state', value: { version: 1, sessionsEnc: true, filesEnc: false },
          })
        } catch (error) { /* 老库没有 meta 存储 */ }
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
  return 'seeded'
})()`)

await send('Page.enable')
await send('Page.reload')
await sleep(3000)

const innerWidthFallback = await evaluate('innerWidth')
// 会话行是 div（不是 button）：真机上左抽屉是收起状态，按坐标点会落到屏幕外，
// 所以直接对它派发一次 click —— React 的合成事件照样收得到。
const rowClicked = await evaluate(`(() => {
  const el = [...document.querySelectorAll('div[class*="item-"]')].find(
    (r) => r.textContent.trim() === '目录测试'
  )
  if (!el) return false
  el.click()
  return true
})()`)
if (!rowClicked) throw new Error('找不到「目录测试」会话')
await sleep(900)
if (!(await evaluate(`document.body.textContent.includes('问题 30')`))) {
  throw new Error('会话没打开（看不到最后一条提问）')
}

await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
await sleep(300)

// 2. 从右往左滑，唤出目录
const closed = JSON.parse(await evaluate(NAV_STATE))
if (closed.open) throw new Error('还没滑就开着')
await swipeLeft(400)
const opened = JSON.parse(await evaluate(NAV_STATE))
console.log('行数：', opened.rows.length, '｜第一行：', opened.rows[0], '｜当前轮：', opened.active)
if (!opened.open) throw new Error('滑了没开')
if (opened.rows.length !== 10) throw new Error(`该显示 10 轮，实际 ${opened.rows.length}`)
if (!opened.active) throw new Error('当前轮没有高亮')
if (!opened.expander?.includes('20')) throw new Error(`展开按钮的数字不对：${opened.expander}`)

// 3. 点一条，看是否收起 + 跳到那一轮
const target = opened.rows[2]
if (!(await clickText(target))) throw new Error(`点不到 ${target}`)
await sleep(900)
const landed = await evaluate(TOP_QUESTION)
const afterClick = JSON.parse(await evaluate(NAV_STATE))
// 诊断用：落点不对时把滚动位置和消息区前几行一起打出来，省得下次还要重新摸一遍
const diag = await evaluate(`JSON.stringify((() => {
  const sc = [...document.querySelectorAll('div')].filter(
    (el) => ['auto','scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
  ).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  const box = sc.getBoundingClientRect()
  return {
    scrollTop: Math.round(sc.scrollTop),
    scrollHeight: Math.round(sc.scrollHeight),
    first: [...document.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /^问题 \\d+$/.test(n.textContent.trim()) && n.closest('[data-turn-id]'))
      .map((n) => ({ text: n.textContent.trim(), y: Math.round(n.getBoundingClientRect().top - box.top) }))
      .slice(0, 4),
  }
})())`)
console.log('点了', target, '→ 视口顶部：', landed, '｜抽屉还开着吗：', afterClick.open, '｜', diag)
if (landed !== target) throw new Error(`应当停在 ${target}，实际 ${landed}`)
if (afterClick.open) throw new Error('点完之后抽屉没有收起')

// 4. 再滑出来，点「展开更早」，两边同时变长
await swipeLeft(400)
const before = JSON.parse(await evaluate(NAV_STATE))
if (!(await clickText('展开更早的'))) throw new Error('点不到「展开更早」')
await sleep(1000)
const after = JSON.parse(await evaluate(NAV_STATE))
console.log('展开前：', before.rows.length, '行｜展开后：', after.rows.length, '行｜按钮：', after.expander)
if (after.rows.length !== before.rows.length + 10) {
  throw new Error(`展开后应当多 10 行：${before.rows.length} → ${after.rows.length}`)
}

// 5. 目录自己的滚动位置：展开时新行插在顶上，正在看的那一行不能跳
const listTop = `(() => {
  const list = [...document.querySelectorAll('div')].find(
    (el) => ['auto','scroll'].includes(getComputedStyle(el).overflowY) && el.querySelector('button[aria-current], button')
  )
  return list
})()`
await evaluate(`(() => {
  const list = ${listTop}
  if (list) list.scrollTop = 200
  return list ? list.scrollTop : null
})()`)
await sleep(300)
const keep = await evaluate(`JSON.stringify((() => {
  const list = ${listTop}
  if (!list) return null
  const box = list.getBoundingClientRect()
  const row = [...list.querySelectorAll('button')]
    .map((b) => ({ text: b.textContent.trim(), y: b.getBoundingClientRect().top - box.top }))
    .filter((r) => r.y >= -4)[0]
  return { scrollTop: Math.round(list.scrollTop), row }
})())`)
if (!(await clickText('展开更早的'))) throw new Error('第二次点不到「展开更早」')
await sleep(900)
const kept = await evaluate(`JSON.stringify((() => {
  const list = ${listTop}
  if (!list) return null
  const box = list.getBoundingClientRect()
  const row = [...list.querySelectorAll('button')]
    .map((b) => ({ text: b.textContent.trim(), y: b.getBoundingClientRect().top - box.top }))
    .filter((r) => r.text === ${JSON.stringify(JSON.parse(keep).row.text)})[0]
  return { scrollTop: Math.round(list.scrollTop), row }
})())`)
const beforeKeep = JSON.parse(keep)
const afterKeep = JSON.parse(kept)
console.log('展开时目录里那行：', beforeKeep.row.text, beforeKeep.row.y, '→', afterKeep.row?.y)
if (!afterKeep.row || Math.abs(afterKeep.row.y - beforeKeep.row.y) > 2) {
  throw new Error(`展开把目录顶跑了：${JSON.stringify(beforeKeep)} → ${JSON.stringify(afterKeep)}`)
}

// 6. 反方向右滑把它收起来（镜像手势）
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
const fromRight = 60
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromRight, y: 400 }] })
for (let step = 1; step <= 12; step += 1) {
  const x = fromRight + ((innerWidthFallback - 20 - fromRight) * step) / 12
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 400 }] })
  await sleep(16)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(450)
const closedBySwipe = JSON.parse(await evaluate(NAV_STATE))
console.log('右滑之后还开着吗：', closedBySwipe.open)
if (closedBySwipe.open) throw new Error('右滑没能把目录收起来')

// 6. 滚到中间，看高亮跟着走
await evaluate(`(() => {
  const sc = [...document.querySelectorAll('div')].filter(
    (el) => ['auto','scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
  ).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  sc.scrollTop = Math.round(sc.scrollHeight / 2)
  return sc.scrollTop
})()`)
await sleep(500)
const scrolled = JSON.parse(await evaluate(NAV_STATE))
console.log('滚到中间后的高亮：', scrolled.active, '｜视口顶部：', await evaluate(TOP_QUESTION))
if (scrolled.active !== (await evaluate(TOP_QUESTION))) {
  throw new Error(`高亮与视口顶部不一致：${scrolled.active} vs ${await evaluate(TOP_QUESTION)}`)
}

// 7. 压缩过的会话：展开到头之后顶上应当是灰字，不是按钮
await evaluate(`(async () => {
  const now = Date.now()
  const messages = []
  for (let n = 1; n <= 6; n += 1) {
    messages.push({ id: 'c' + n + 'u', role: 'user', content: '问题 ' + n, files: [], createdAt: now })
    messages.push({
      id: 'c' + n + 'a', role: 'assistant', createdAt: now, model: null, prefix: true,
      status: 'done', blocks: [{ type: 'text', text: '回答 ' + n }],
    })
  }
  const session = {
    id: 'probe-turn-nav-compacted', title: '目录测试-压缩', createdAt: now, updatedAt: now, messages, schema: 1,
    compaction: {
      summary: '## 摘要\\n旧的对话摘要正文',
      coveredIds: messages.slice(0, 8).map((m) => m.id),
      createdAt: now, mode: 'manual', beforeTokens: 9000, afterTokens: 900, model: null,
    },
  }
  const req = indexedDB.open('chat-demo')
  await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
      tx.objectStore('sessions').put(session)
      tx.objectStore('sessionSummaries').put({
        id: session.id, title: session.title, createdAt: now, updatedAt: now, fileIds: [],
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
  return 'seeded'
})()`)
await send('Page.reload')
await sleep(3000)
const compactedClicked = await evaluate(`(() => {
  const el = [...document.querySelectorAll('div[class*="item-"]')].find(
    (r) => r.textContent.trim() === '目录测试-压缩'
  )
  if (!el) return false
  el.click()
  return true
})()`)
if (!compactedClicked) throw new Error('找不到「目录测试-压缩」会话')
await sleep(900)
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
await swipeLeft(400)
const compacted = JSON.parse(await evaluate(NAV_STATE))
console.log('压缩会话：', compacted.rows.length, '行｜灰字：', compacted.hint, '｜按钮：', compacted.expander)
if (!compacted.hint) throw new Error('压缩过的会话没有显示灰字')
if (compacted.expander) throw new Error('已经展开到头，不该再有「展开更早」')

console.log('✔ 右侧目录：唤出 / 行数 / 高亮 / 跳转 / 展开同步 / 右滑关闭 / 压缩灰字 全部符合预期')
ws.close()
