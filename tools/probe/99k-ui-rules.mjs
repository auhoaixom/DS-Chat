// 界面规矩探针：把「哪些文字能被长按选中」和「设置面板的字号是否统一」变成可机检的输出。
//
// 为什么需要它：这两类问题都是"逐处补、新功能就又漏"的坑 —— 问候语补过、侧边栏补过，
// 设置面板一直漏着。靠人眼看一遍等于没查。规矩写在 STANDARDS.md，这里只负责把违规列出来。
//
// 用法：
//   node tools/probe/99k-ui-rules.mjs              # 报告，总是退出码 0
//   node tools/probe/99k-ui-rules.mjs --strict     # 有违规就退出码 1
//   node tools/probe/99k-ui-rules.mjs --chat-only  # 只看当前屏幕，不开设置面板
//
// 连哪里：
//   桌面：先起 pnpm dev + 带 --remote-debugging-port=9333 的 Chromium（见 README）
//   真机：dev 包（BuildConfig.DEBUG 打开 WebView 调试）——
//     adb shell cat /proc/net/unix | findstr webview_devtools_remote
//     adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//     $env:CDP_HOST = '127.0.0.1:9333'
//
// 判定口径（STANDARDS.md「界面规矩」第 1 条）：
//   默认一切不可选中；只有 [data-selectable]、textarea/input、contenteditable、pre/code 里的文字可以选中。
//   所以「违规」= 有自己文字、看得见、计算值 user-select 不是 none、又不在白名单里的元素。
const host = process.env.CDP_HOST || '127.0.0.1:9333'
const strict = process.argv.includes('--strict')
const chatOnly = process.argv.includes('--chat-only')

const targets = await (await fetch(`http://${host}/json/list`)).json()
// 桌面是 http://localhost:8090，真机 WebView 是 https://localhost
const page = targets.find((t) => t.type === 'page' && /localhost/.test(t.url))
if (!page) {
  console.error(`没有找到 localhost 页面（${host}）：${targets.map((t) => t.url).join(', ') || '空'}`)
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
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 500))
  }
  return reply.result?.result?.value
}

/** 违规清单：只看"自己直接带文字"的元素，按 标签+类名 归并，免得一次吐出几百行。 */
const auditScript = (scope) => `(() => {
  const WHITELIST = '[data-selectable], textarea, input, [contenteditable=""], [contenteditable="true"], pre, code'
  const root = ${scope ? `document.querySelector('${scope}')` : 'document.body'}
  if (!root) return JSON.stringify({ bodyUserSelect: '', violations: [], missingScope: true })
  const groups = new Map()
  for (const el of root.querySelectorAll('*')) {
    let text = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue
    }
    text = text.trim()
    if (!text) continue
    if (el.closest('[aria-hidden="true"]')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (style.userSelect === 'none') continue
    if (el.closest(WHITELIST)) continue
    const cls = typeof el.className === 'string' ? el.className : ''
    const key = el.tagName + '|' + cls + '|' + style.userSelect
    const group = groups.get(key) ?? {
      tag: el.tagName,
      cls: cls.slice(0, 70),
      userSelect: style.userSelect,
      count: 0,
      samples: [],
    }
    group.count += 1
    const sample = text.slice(0, 20)
    if (group.samples.length < 3 && !group.samples.includes(sample)) group.samples.push(sample)
    groups.set(key, group)
  }
  return JSON.stringify({
    bodyUserSelect: getComputedStyle(document.body).userSelect,
    violations: [...groups.values()].sort((a, b) => b.count - a.count),
  })
})()`

/** 设置面板的字号/颜色分布：不判红，只把聚类摆出来，一眼能看出谁跟大家不一样。 */
const fontScript = (scope) => `(() => {
  const panel = document.querySelector('${scope}')
  if (!panel) return JSON.stringify({ error: '没有找到设置面板' })
  const clusters = new Map()
  for (const el of panel.querySelectorAll('*')) {
    let text = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue
    }
    text = text.trim()
    if (!text || text.length > 24) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const key = style.fontSize + '|' + style.fontWeight + '|' + style.color
    const cluster = clusters.get(key) ?? {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      count: 0,
      samples: [],
    }
    cluster.count += 1
    const sample = text.slice(0, 12)
    if (cluster.samples.length < 4 && !cluster.samples.includes(sample)) cluster.samples.push(sample)
    clusters.set(key, cluster)
  }
  return JSON.stringify({ clusters: [...clusters.values()].sort((a, b) => b.count - a.count) })
})()`

/** 设置面板里所有滚动容器的溢出量：窗口高度是算出来的，一旦有内容超出就有人要滚。 */
const overflowScript = (scope) => `(() => {
  const panel = document.querySelector('${scope}')
  if (!panel) return JSON.stringify({ error: '没有找到设置面板' })
  const scrolling = []
  for (const el of panel.querySelectorAll('*')) {
    const style = getComputedStyle(el)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    if (el.clientHeight === 0) continue
    scrolling.push({
      hidden: el.scrollHeight - el.clientHeight,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    })
  }
  return JSON.stringify({ scrolling })
})()`

const out = { target: page.url }
// 1. 当前屏幕（会话页或新对话页）
const chat = JSON.parse(await evaluate(auditScript(null)))
out.chat = chat

// 2. 打开设置面板，只看弹窗里那一片（侧边栏还在 DOM 里，不划范围会重复统计）
if (!chatOnly) {
  const opened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '设置')
    if (!trigger) return false
    trigger.click()
    return true
  })()`)
  out.settingsOpened = opened
  if (opened) {
    await sleep(600)
    // 第一层：分类列表
    out.settings = JSON.parse(await evaluate(auditScript('[role="dialog"]')))
    out.settingsFonts = JSON.parse(await evaluate(fontScript('[role="dialog"]')))
    out.settingsOverflow = JSON.parse(await evaluate(overflowScript('[role="dialog"]')))
    // 第二层：进一个子页再看一遍——具体设置项都在子页里，只查列表等于什么都没查
    // 分类行现在是「名称 + 状态摘要」两行，用 includes 匹配，别按整行文字全等
    const entered = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return false
      const row = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('个性化'))
      if (!row) return false
      row.click()
      return true
    })()`)
    if (entered) {
      await sleep(500)
      out.settingsPage = JSON.parse(await evaluate(auditScript('[role="dialog"]')))
      out.settingsPageFonts = JSON.parse(await evaluate(fontScript('[role="dialog"]')))
      out.settingsPageOverflow = JSON.parse(await evaluate(overflowScript('[role="dialog"]')))
      await evaluate(`(() => {
        const back = document.querySelector('[aria-label="返回上一级"]')
        if (back) back.click()
      })()`)
      await sleep(400)
    }
    // 「关于」是 1.6.0 新加的一页：一整行状态文字 + 可能并排的两颗按钮，
    // 字号与换行都得单独看一遍，不能靠"跟个性化长得像"推断
    const enteredAbout = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return false
      const row = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('关于'))
      if (!row) return false
      row.click()
      return true
    })()`)
    if (enteredAbout) {
      await sleep(500)
      out.settingsAbout = JSON.parse(await evaluate(auditScript('[role="dialog"]')))
      out.settingsAboutFonts = JSON.parse(await evaluate(fontScript('[role="dialog"]')))
      out.settingsAboutOverflow = JSON.parse(await evaluate(overflowScript('[role="dialog"]')))
      await evaluate(`(() => {
        const back = document.querySelector('[aria-label="返回上一级"]')
        if (back) back.click()
      })()`)
      await sleep(400)
    }
    await evaluate(`(() => {
      const close = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭')
      if (close) close.click()
    })()`)
    await sleep(300)
  }
}

console.log(JSON.stringify(out, null, 2))

const violations =
  out.chat.violations.length +
  (out.settings?.violations.length ?? 0) +
  (out.settingsPage?.violations.length ?? 0) +
  (out.settingsAbout?.violations.length ?? 0)

/** 滚出容器哪怕只有 1dp，也算这一屏装不下——窗口高度是算出来的，不该靠滚动补 */
const overflowViolations = [
  ['设置列表', out.settingsOverflow],
  ['设置子页', out.settingsPageOverflow],
  ['设置关于', out.settingsAboutOverflow],
].flatMap(([label, report]) =>
  (report?.scrolling ?? [])
    .filter((item) => item.hidden > 1)
    .map((item) => ({ label, ...item }))
)
const baseline = out.chat.bodyUserSelect !== 'none'
console.log('')
if (baseline) {
  console.log(
    `基线模式：body 的 user-select 还是 "${out.chat.bodyUserSelect}"，全局默认尚未改，` +
      '下面的清单是"改造前还剩多少地方可被长按选中"。'
  )
}
console.log(`可被长按选中的文字块：会话页 ${out.chat.violations.length} 组` +
  (out.settings ? `，设置列表 ${out.settings.violations.length} 组` : '') +
  (out.settingsPage ? `，设置子页 ${out.settingsPage.violations.length} 组` : '') +
  (out.settingsAbout ? `，关于页 ${out.settingsAbout.violations.length} 组` : ''))
for (const group of [
  ...out.chat.violations,
  ...(out.settings?.violations ?? []),
  ...(out.settingsPage?.violations ?? []),
  ...(out.settingsAbout?.violations ?? []),
]) {
  console.log(`  ${group.tag} ×${group.count}  ${group.samples.join(' / ')}`)
}
for (const [label, fonts] of [
  ['设置列表', out.settingsFonts],
  ['设置子页', out.settingsPageFonts],
  ['关于页', out.settingsAboutFonts],
]) {
  if (!fonts?.clusters) {
    continue
  }
  console.log(`${label}字号分布（同一组里只该有一个值）：`)
  for (const cluster of fonts.clusters) {
    console.log(`  ${cluster.fontSize} / ${cluster.fontWeight} / ${cluster.color}  ×${cluster.count}  ${cluster.samples.join(' / ')}`)
  }
}
console.log(
  overflowViolations.length === 0
    ? '设置面板溢出：无（每一页都装得下，不用滚）'
    : `设置面板溢出：${overflowViolations.length} 处需要滚动 ❌`
)
for (const item of overflowViolations) {
  console.log(`  ${item.label} 藏了 ${item.hidden}dp（可见 ${item.clientHeight}dp / 内容 ${item.scrollHeight}dp）`)
}
ws.close()
if (strict && violations > 0) {
  console.log('判定：仍有可被长按选中的静态文字 ❌')
  process.exit(1)
}
if (strict && overflowViolations.length > 0) {
  console.log('判定：设置面板里有内容装不下 ❌')
  process.exit(1)
}
