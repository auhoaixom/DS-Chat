# 回归探针

真机上复现不了、或者复现起来太慢的交互问题，用这里的脚本在**桌面 Chromium** 里按真实事件重放一遍。
它们不是单元测试（`pnpm test` 跑不到 DOM），是"改完之后亲眼确认一遍"的工具。

## 前置

```powershell
pnpm dev                     # rspack serve，127.0.0.1:8090
```

另开一个 Chromium（Edge 也行），带调试端口：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --remote-debugging-port=9333 `
  --user-data-dir=$env:TEMP\ds-probe --no-first-run `
  --window-size=1440,900 http://localhost:8090
```

`--user-data-dir` 指到临时目录，别用你的日常浏览器配置。

## 脚本

| 脚本 | 验什么 | 注意 |
|---|---|---|
| `cdp.mjs <snippet.js>` | 通用执行器：连上 9333，把 snippet 放进页里跑 | 最底层的工具，其余脚本各自带 CDP 连接 |
| `99-longpress.mjs [holdMs]` | 侧边栏长按菜单：按住 → 松手 → 菜单还在不在（默认 1000ms） | **按住必须 ≥1 秒**，短按暴露不了那个 bug |
| `99c-regress.mjs` | 长按菜单的四项回归：补发 contextmenu 不关、点行收起、点外收起、菜单项可点 | 先跑 `99-longpress` 确认能开 |
| `99d-originals.mjs` | 「查看原文 → 下滑 → 收起」的滚动位置（**桌面布局**） | 桌面有浏览器自带的滚动锚定兜底，测不出偏漂；真要验用 `99h` |
| `99h-mobile.mjs` | 同上，但切到 **400×860 移动仿真**再量 | 判据是"视口顶部那一条提问"是否还是展开前那条 |
| `99i-thinking.mjs [--expand] [--hold]` | 深度思考小窗：灌 600 字思考，看结束时的展开状态与页面跟随距离；`--hold` 额外断言点开/收起后标题行位移 ≤6px | 默认判据是「结束时应收起」，`--expand` 反过来；两种都逐 50ms 采样 |
| `99j-composer-focus.mjs` | 输入栏焦点归属：点「深度思考 / 智能搜索 / ＋」之后 `activeElement` 是不是还是 textarea | 键盘本身在浏览器里看不到，所以断言的是成因，不是结果 |

## 三条踩过的坑

- **reload 之后的第一下点击会被页面取焦点吃掉**，脚本里都先做一次预热点击。
- **没有 API Key 时应用会自动弹设置浮层**，挡住会话列表；脚本会先往 localStorage 塞一个假 key
  （`chat-demo:api-key`），或者等浮层关掉再点。塞进去的是明文，1.4.0 起启动时 `unlockApiKey`
  会在读到明文后把它加密写回 —— 不影响脚本（内存里仍是那个值），但别指望下次读到的还是明文。
- **1.4.0 起，库里有会话就会弹加密引导框**：位置 `fixed`、`z-index: 1100`，把后面每一次点击
  全吃掉。所以每个种数据的脚本都顺手往 `meta` 存储写一条
  `{ key: 'enc-state', value: { version: 1, sessionsEnc: true, filesEnc: false } }`，
  让启动流程认为「已经加密完成」，直接往下走。

## 数据

`99d` / `99h` 会往 IndexedDB 里种一条测试会话（`probe-originals`，30 轮问答 + 一条覆盖前 16 条的压缩记录），
种完会 `Page.reload`；`99-longpress` 自己种一条 `长按测试会话`。**每个脚本的数据自己造，互不依赖**，
连续跑也没问题（各自开头会把视口复位到桌面尺寸）。这是**探针专用的浏览器配置**，不会碰到你自己的数据。

种进去的是**明文记录**（老形状：记录上有 `title` / `messages`）。1.4.0 之后 `db.ts` 读记录时会先看
有没有 `meta` 字段：没有就当成「迁移前的旧记录」原样返回，所以明文会话仍然能正常打开。这也是上面那条
`enc-state` 标记的意义 —— 标记说「已完成」，读取路径就只管兼容旧形状，不会再触发一次迁移。

**不要**在探针里改成种加密记录：写密文需要密钥和 `sealSession`，等于把被测的逻辑再实现一遍，
探针就失去了「独立于实现」的价值。

