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

## 两条踩过的坑

- **reload 之后的第一下点击会被页面取焦点吃掉**，脚本里都先做一次预热点击。
- **没有 API Key 时应用会自动弹设置浮层**，挡住会话列表；脚本会先往 localStorage 塞一个假 key
  （`chat-demo:api-key`），或者等浮层关掉再点。

## 数据

`99d` / `99h` 会往 IndexedDB 里种一条测试会话（`probe-originals`，30 轮问答 + 一条覆盖前 16 条的压缩记录），
种完会 `Page.reload`；`99-longpress` 自己种一条 `长按测试会话`。**每个脚本的数据自己造，互不依赖**，
连续跑也没问题（各自开头会把视口复位到桌面尺寸）。这是**探针专用的浏览器配置**，不会碰到你自己的数据。

