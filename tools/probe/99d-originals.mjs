// 「查看原文 / 收起原文」的滚动位置回归。
// 期望：展开 → 往下滑 → 收起，视口回到展开那一刻（点开时看到哪，收起就看到哪）。
// 需要：pnpm dev（8090）+ Edge --remote-debugging-port=9333
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
const click = async (x, y, hold = 60) => {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(hold)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
  })
  await sleep(300)
}

await send('Page.enable')
// 上一个脚本可能把视口留在移动仿真上，这里明确回到桌面尺寸
await send('Emulation.clearDeviceMetricsOverride')

/** --reuse：页面已经是热的（数据已种好、会话列表已加载），跳过种数据与 reload */
const reuse = process.argv.includes('--reuse')

// 1. 造一条「压缩过 + 还有很多可见消息」的会话；顺手塞一个假 API Key，
//    否则没有 key 时应用会在 reload 后自动弹设置浮层，挡住会话列表
if (!reuse) {
// 只在**完全没有** key 时补一个占位值，绝不覆盖已有值：应用会把明文当 key 用并加密写回，
// 覆盖等于把用户填好的 key 冲成假的（2026-11-28 踩过，压缩一路 401 却报「稍后再试」）。
await evaluate(`(() => {
  if (localStorage.getItem('chat-demo:api-key') === null) localStorage.setItem('chat-demo:api-key', 'probe-key')
  return 'key'
})()`)
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
  const coveredIds = messages.slice(0, 16).map((m) => m.id)
  const session = {
    id: 'probe-originals', title: '原文收起测试', createdAt: now, updatedAt: now,
    messages, schema: 1,
    compaction: {
      summary: '## 摘要\\n旧的对话摘要正文', coveredIds, createdAt: now, mode: 'manual',
      beforeTokens: 9000, afterTokens: 900, model: null,
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
await sleep(2600)

// 预热：reload 之后的第一下输入会被页面取焦点吃掉
await click(900, 400)
await sleep(500)
}

// 2. 打开这条会话
const row = await evaluate(`(() => {
  const el = [...document.querySelectorAll('div[class*="item-"]')].find(
    (r) => r.textContent.trim() === '原文收起测试'
  )
  if (!el) return null
  const b = el.getBoundingClientRect()
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
})()`)

// 3. 工具：滚动容器、状态快照、按钮点击
const SCROLLER = `(() => {
  const list = [...document.querySelectorAll('div')].filter(
    (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20
  )
  const best = list.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  return best || null
})()`
/** 视口最上沿那一条提问 —— 这才是用户眼里的"位置" */
const TOP_QUESTION = `(() => {
  const sc = ${SCROLLER}
  if (!sc) return null
  const box = sc.getBoundingClientRect()
  return (
    [...document.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /^问题 \\d+$/.test(n.textContent.trim()))
      .map((n) => ({ text: n.textContent.trim(), top: n.getBoundingClientRect().top }))
      .filter((n) => n.top >= box.top - 4 && !n.text.includes('原文'))
      .sort((a, b) => a.top - b.top)[0]?.text ?? null
  )
})()`
const STATE = `JSON.stringify({
  scrollTop: Math.round(${SCROLLER}.scrollTop),
  top: ${TOP_QUESTION},
  originals: document.body.textContent.includes('以下为已压缩的原文'),
})`
/** 按钮直接调 .click()：卡片是 sticky 的，按坐标点会因为布局微动点空（实测踩过） */
const clickByText = (label) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${label}')
    if (!el) return false
    el.click()
    return true
  })()`)

const waitFor = async (expression, label, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) {
      return
    }
    await sleep(200)
  }
  throw new Error(`等不到：${label}`)
}

// 点到开为止：reload 之后第一次点击偶尔会被"取焦点"吃掉（实测），多点一次无害
for (let attempt = 0; attempt < 4; attempt += 1) {
  await click(row.x, row.y)
  const ready = await evaluate(
    `!!${SCROLLER} && document.body.textContent.includes('上下文已压缩')`
  )
  if (ready) break
  await sleep(600)
}
console.log(
  '打开尝试后的状态：',
  await evaluate(`JSON.stringify({
    body: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 140),
    scroller: !!${SCROLLER},
    row: ${JSON.stringify(row)},
  })`)
)
await waitFor(
  `!!${SCROLLER} && document.body.textContent.includes('上下文已压缩')`,
  '会话渲染完成'
)

// 4. 回到最上面（压缩卡片所在处），记下展开前的位置
await evaluate(`(() => { ${SCROLLER}.scrollTop = 0; return 'top' })()`)
await sleep(700)
const before = JSON.parse(await evaluate(STATE))

// 5. 展开原文
if (!(await clickByText('查看原文'))) throw new Error('找不到「查看原文」')
await sleep(600)
const expanded = JSON.parse(await evaluate(STATE))

// 6. 在原文里往下滑 400px（用户描述的动作）
await evaluate(`(() => { const el = ${SCROLLER}; el.scrollTop = el.scrollTop + 400; return el.scrollTop })()`)
await sleep(500)
const scrolled = JSON.parse(await evaluate(STATE))

// 7. 收起原文
if (!(await clickByText('收起原文'))) throw new Error('找不到「收起原文」')
await sleep(700)
const collapsed = JSON.parse(await evaluate(STATE))

console.log(JSON.stringify({ before, expanded, scrolled, collapsed }))
console.log(
  '判定：',
  collapsed.top === before.top
    ? `收起后视口顶部仍是 ${before.top} ✅`
    : `收起后视口顶部 ${before.top} → ${collapsed.top} ❌（scrollTop ${before.scrollTop} → ${collapsed.scrollTop}）`
)
ws.close()
