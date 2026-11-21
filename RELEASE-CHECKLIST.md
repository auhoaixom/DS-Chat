# 发版检查表

每一版都按这张表走。**任何一项没过，就不发版。**

目的是把"靠记忆的回归"换成"照着做的清单"，避免某一版漏掉某一项而没人发现。

---

## 0. 环境

```powershell
$env:PATH="E:\Android\node22;E:\Android\node22\node_modules\npm\bin;E:\Android\jdk21\bin;E:\Android\Sdk\platform-tools;$env:PATH"
$env:JAVA_HOME="E:\Android\jdk21"
$env:ANDROID_HOME="E:\Android\Sdk"
$env:ANDROID_SDK_ROOT="E:\Android\Sdk"
```

设备：`US95VW7T9LEQNBBI`（Redmi 14C，720×1640，density 2.0）

---

## 1. 版本号三处一致

| 位置 | 字段 |
|---|---|
| `package.json` | `version` |
| `android/app/build.gradle` | `versionName` |
| `android/app/build.gradle` | `versionCode`（每版 +1，只增不减） |

改 gradle 文件**不要用 `Set-Content`**（会写 BOM，gradle 解析失败），用：

```powershell
$p=(Resolve-Path 'android\app\build.gradle').Path
$t=[IO.File]::ReadAllText($p).Replace('versionCode 36','versionCode 37')
[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding($false)))
```

---

## 2. 静态检查（三项全绿才继续）

```powershell
pnpm type     # 无输出即通过
pnpm lint     # 0 warnings 0 errors
pnpm test     # 全过
```

> `pnpm format` **不要随手跑**：它会把全仓重写一遍（曾一次改动 180 个文件）。真要格式化，单独开一版只做格式化。

---

## 3. 构建与安装

```powershell
pnpm build
npx cap sync android
cd android; .\gradlew.bat assembleRelease --console=plain
adb install -r app\build\outputs\apk\release\app-release.apk
```

---

## 4. 手工回归（十项，逐项截图）

每一项都要在真机上做，并留下截图。

| # | 项 | 操作 | 通过标准 |
|---|---|---|---|
| 1 | 普通发送 | 新建会话，输入一句话发送 | 出现回复；标题自动生成；用量环更新 |
| 2 | 重新生成 | 点回复下方的重新生成 | 旧内容**完全消失**；下方出现版本切换器且为 `2 / 2` |
| 3 | 分支切换 + 发送 | 点 `<` 切到 `1 / 2`，再发一条新消息 | 新消息接在**切换后的分支**上，不在原来那条后面 |
| 4 | 编辑后重发 | 点提问气泡下方的铅笔，改几个字再发送 | 提问变新内容并出现 `2 / 2`；**原来下面的回答整段消失**（换了分支） |
| 5 | 继续生成 | 发一条会写长的请求 → **生成中途点停止** → 出现「继续生成」按钮 → 点它 | 正文从断点**无缝接续**，不重复已写内容；接续完成后按钮消失 |
| 6 | 带图片发送 | 点 ＋ → 选一张最近照片 → 发送 | 回答能说出图片里的**具体内容**（不是只说"收到一张图"）；LaTeX/表格正常渲染 |
| 7 | 侧边栏拖动 | ① 从屏幕**任意位置**（左、中、右）慢速右滑 0.9cm 松手 ② 任意位置慢速右滑 0.5cm 松手 ③ 抽屉展开后同样在**任意位置**慢速左滑 0.9cm ④ 纵向滚动、长按选字后拖、输入框内右滑、设置弹窗上右滑 | ①②③ 全程**跟手指**移动；**0.9cm 必切换，0.5cm 必回弹**，起手位置与方向都对称；④ 都不接管（滚动/选字/移动光标照常） |
| 8 | 浮层点击不穿透 | ① 长按会话行弹菜单后，点**另一条会话** ② 菜单里点「重命名」，改几个字后点别处（应**保存**改名） ③ 打开顶栏上下文面板后点面板外的空白 | 三者都**只关闭浮层**：不切会话、不选中文字、不关抽屉；其中 ② 改名要按新内容保存（Esc 才放弃） |
| 9 | 长按菜单与三态 | ① 任意会话行长按 0.5 秒弹菜单（没有 ⋯ 按钮）② 菜单开着时点**另一条会话** ③ 打开某条会话后再开抽屉看三态 ④ 菜单里点置顶，再长按同一行看「取消置顶」 | ① 该行出现选中底色、文字仍为白色 ② 只关菜单：不切会话、不关抽屉 ③ 当前打开的会话是**蓝字+底色**，长按行只有底色，其余无变化 ④ 置顶/取消置顶都即时刷新列表 | 置顶后出现「置顶」分组在最上方且该会话从日期分组消失；取消后回到原来位置（updatedAt 未被污染）；杀掉应用重开仍保持 |
| 10 | 诊断信息分层 | ① 打开有内容的会话 → 设置 → 数据管理 → 诊断信息 → 查看 ② 点「详细」 ③ 点「复制」，再粘到输入框看内容 | ① 摘要**七行、逐行不折行**，一眼能看到缓存命中率、无服务端 ID 数、失败条数 ② 明细给出逐条用量与失败原文，自己滚动、不把弹窗撑高 ③ 粘出来的是**摘要 + 明细全文**，与是否展开无关 |

**第 10 项的契约（别改回去）**：

- 摘要里**每个板块必须留一句结论**（压缩给前后值、失败给条数与最近一条原因），这样折起来也不会有「某项出事了但看不见」的盲区；原文与逐条用量只放明细。
- 复制的永远是 `composeReport()`（摘要 + 明细），**不受展开状态影响**——复制出去是为了排查，不能因为折叠就少一半。
- 摘要的排版预算：真机 720 宽（360 CSS px）、等宽 11px 下**一行约 24 个汉字**。`压缩`/`失败` 两行最初按「覆盖条数 50」「最近 23:59:59」写就各多出 5–8 个字符，实测折行、七行变八行，改成「50 条」「，23:59:59」才收进一行。以后往摘要加字段先数这一行的字数。
- 英文界面下摘要有折行（约 10 行，无截断），只在英文下出现，不影响中文。

**上下文用量的口径（v0.9.6 按真机实测校准，别改回去）**：

- 面板三项「对话消息 / 系统提示词 / 请求开销」相加**必须等于**合计，余数归给对话消息。请求开销以前混在「对话消息」里，一轮短对话会把 800 当成对话内容。
- `REQUEST_OVERHEAD` 现在是 **56**，不是 800。旧值把每个短请求都估成十几倍：真机上一轮「82374919*61525321」服务端实测 `in = 64`，我们估 828，锚定后按比例摊回去，「系统提示词」只剩 1。要改这个常量，先在同一台设备上量一条单轮请求的 `in`。
- 锚点的净增减**只认正数**：`used = anchorUsage + max(0, rawTotal - anchorEstimate)`。估算口径一改，历史消息里存的 `promptEstimate` 就成了旧尺子，差值会变成大负数；只认正数才能保证占用不会凭空归零（实测应为 64，而不是 0 或 <1）。
- 锚点是否可信**只看一条**：提示侧用量 ≥ 32 token。**不要**再加「实测 / 估算」的比值下限——估算本来就偏大、比值小是常态，加了会把好锚点整批丢掉（v0.9.6 的第一版就是这么错的，装的包已作废）。
- 明细里的「锚点」一行要能自解释：`实测 64 · 估算 828（差 -92%）` 一眼看出是估算偏高还是服务端用量异常。

**用量面板（v0.9.8 起只有三项 + K 单位）**：

- 三行固定为「固定开销 / 摘要 / 对话内容」，对应三种动作：动不了 / 能撤销 / 能删能压。**不显示输出余量**——窗口是输入输出共用的，但面板只回答"已经占了多少"。
- **摘要行只在真有压缩记录时出现**（判据 `usage.compacted`，来自 applyCompaction 的实际生效结果）：没压缩过、或撤销压缩之后，这一行整行消失，不许留一个 `≈ <1K` 的幽灵词条（v0.9.8 犯过这个错，v0.9.9 修）。
- 单位一律 K（按 1024 计，与窗口同一把尺子）：不足 1K 写 `<1K`，1K–9.9K 一位小数，10K 起取整；窗口写 `1024K`。**出现的行都是 `<1K` 时也照常列出来，不折叠成一句话**。
- 数字前带 `≈`，数字行末尾标 `实测` / `估算`（来自 `usage.anchor`）：合计是锚定实测，三项是估算摊分，界面必须能看出来。
- 摘要与系统提示词在数据层已分开（`summaryTokens` / `systemTokens`），面板把它们当两笔不同的账；以前压缩后两者混在一行，同一行标签指两样东西。
- 诊断信息**不用**这套写法：那里继续用 `formatTokens`（能显示 343、in 35 这种精确值）和 1.0M，排查时看的是准确数字。

**写回会话的两条纪律（v0.9.11 起有测试钉住）**：

- 重命名、置顶一律「整条读出 → 改一个字段 → 原样写回」，走 `db.ts` 的 `withTitle` / `withPinned`，**不要用摘要重建会话**：摘要（`toStoredSummary`）只有 id/标题/时间/置顶/文件 id，照它拼一个会话等于把 `messages` 和 `compaction` 洗掉。
- 对应测试在 `test/dbSession.test.ts`：patch 之后 `compaction` 与 `messages` 必须还是同一个引用，摘要里不许出现这两个字段。

**拒答收尾与用量合并（v0.9.11 起有单测）**：

- `settleReply` 在 `stop_reason: 'refusal'` 时丢弃全部 thinking/text、只留工具块——这条路径真机很难复现（不再声明 safety_check），只能靠 `test/reply.test.ts`。
- `message_delta` 只带 `output_tokens` 时会被整份丢弃，`message_start` 报的输入侧必须保留；四个数字齐全才整体替换。别把"估算偏高"再误判成"服务端只回了输出侧"。

**导出包的扩展字段（v0.9.12 起）**：

- 官方格式（`EXPORT_FORMAT_VERSION = 3`）**一个字节都不改**。压缩记录、逐条用量、系统信息快照、模型名、可续写标记写进各条的 `ds_chat` 里，带自己的 `DS_CHAT_VERSION`。
- 读的时候**宽松**：`ds_chat` 版本不认识或内容坏了就当没有，只是上下文退化成估算，绝不能让整份导入失败（这条由 `test/historyRoundTrip.test.ts` 的"扩展坏掉"用例守着）。
- 导出的是**整棵消息树**（`parent_id` + `current_message_id`），不是当前选中路径；分支的全部版本都在包里。别为了"减小体积"改成只导出可见路径。
- 往返测试覆盖：压缩记录、全部分支版本、逐条用量、系统信息快照、模型名、可续写标记，以及"官方包没有扩展也能导入"。

**会话列表的重渲染成本（v0.9.15 起，别改回去）**：

- `SessionItem` 虽然用 `memo` 包着，但**传给它的回调必须是稳定引用**：`Sider` 里用 `useCallback` 收成 `requestDelete`，`SessionItem` 调 `onDelete(session)`。以前是内联 `() => setDeleting(session)`，每次渲染都是新闭包，memo 对 1239 行**全部失效**——数据一个字没变也要全量重跑。
- 量法：页内 rAF 探针 + `PerformanceObserver({ entryTypes: ['longtask'] })`，动作选「切回前台」（`focus` 会让 `Sider` 把 `now` 写新、重算分组），因为它不改变任何数据，纯粹看渲染成本。
- 实测（Redmi 14C，1239 条会话）：纯重渲染 133/150 ms → **27/34/39 ms 且长任务为空**；置顶 164 ms → 0；取消置顶 121 ms → 0；点一行切会话 109+180 ms → 59 ms。
- 成本分布：React 渲染约占三分之二，样式+布局+绘制约占三分之一（把抽屉 `display:none` 后同一动作从 133 ms 降到 89 ms 得出）。别指望用 CSS containment 解决。
- 剩下的大头**不在列表**：切进长对话是消息面板的成本，见下一条。

**消息列跳过屏幕外排版（v0.9.16 起，别改回去）**：

- `MessageList.module.css` 的 `.column > *` 上有 `content-visibility: auto` + `contain-intrinsic-size: auto 200px`。屏幕外的消息不排版不绘制，滚到那里再真实排版。
- `contain-intrinsic-size` 必须带 `auto`：它让浏览器记住排过的真实高度。写成固定像素，长对话滚到底时滚动条按估值算，会一路抖。
- 为什么是它：60 条消息的对话，切进去是 609ms 主线程长任务，**CPU profile 里 JS 只占 5ms**，其余是浏览器的布局与绘制（不是我们的代码）。加上之后 609 → 392/249ms，已经贴到「一条消息都不排版」的地板（301ms）。
- 别指望它救超大对话：258 条消息那种从 1990ms 只降到 1748ms（12%）。那个规模的成本是**创建一万多个 DOM 节点 + 解析 markdown**（JS 274ms、node 创建 40ms、GC 88ms），靠下面那条分段挂载解决。
- 「等抽屉收起再渲染对话」这个方案测算过是**搬移不是优化**：动画 220ms 结束后才开始那 1.7s，动画不抖了，但空白从 0 变成 1.7s，内容出现的总时间不变。

**消息分段挂载（v0.9.17 起，别改回去）**：

- `MessageList.tsx`：打开只挂末尾 `INITIAL_MESSAGES = 20` 条，滚到离顶部 `LOAD_OLDER_THRESHOLD = 400` 时一次往前补 `OLDER_CHUNK = 5` 条。258 条消息的对话打开时间 **1748ms → 322/369ms**，补一批 56–60ms。
- 窗口存的是**「从第几条开始」**，不是「挂多少条」。按条数存的话，流式回复进来会让上沿往前滑，正在往上翻旧消息的人会被顶一下。**上界必须钳到 `messages.length - INITIAL_MESSAGES`，不是最后一条**：压缩会把早期消息压进摘要、切分支也可能让可见消息变少，钳到最后一条会当场把整条对话缩成一条（v0.9.18 修的）。
- 切会话时窗口在**渲染期间**就按新会话的条数重算（`windowState.sessionId === session.id ? … : …`），否则会先按上一个会话的窗口挂一次。
- 补载的滚动补偿**按锚点元素的实际位置算，不能按 `scrollHeight` 差算**：消息上有 `content-visibility`，屏幕外的先按 200px 估高、滚进来才换真实高度，滚动高度会在补载的同一帧被纠正。实测按高度差算要多补 12.7 倍（高度差 12707 vs 新内容实际 2080），画面直接跳走。按元素位置算的实测是 1.4 秒内零漂移。
- 不卸载已经补进来的消息（不做真虚拟化）：滚到最顶之后所有消息都是挂着的，但那笔开销被摊成了几十次 5 条。
- 调整 `INITIAL_MESSAGES` / `OLDER_CHUNK` / 阈值之前，先量两个数：打开耗时、补载后锚点有没有漂移。

**会话状态机的场景测试（v0.9.22 起）**：

`store.ts` 是唯一没有测试覆盖的核心逻辑：会话读写、内存缓存淘汰、流式与落盘、导入换库。现在有四个场景测试守着：

| 文件 | 守什么 |
|---|---|
| `test/store-load.test.ts` | 读取期间改名，旧读取回来不能把标题盖回去（`sameSummary` 合并） |
| `test/store-switch.test.ts` | 连点两条对话：两条都进缓存，`activeId` 停在最后点的那条 |
| `test/store-epoch.test.ts` | 导入期间迟到的读取结果被 `historyEpoch` 挡住，不写进新数据 |
| `test/store-cache.test.ts` | 缓存淘汰（上限 5）绝不踢当前打开的会话 |
| `test/store-save-failure.test.ts` | 落盘失败要亮错误；重试成功后错误消失且数据真的进库 |
| `test/store-delete-streaming.test.ts` | 删一条正在生成回答的对话：**先等流收尾再真删**（不是先中断） |
| `test/store-pending-files.test.ts` | 落盘失败时图片原件留在 `pendingFiles`，重试成功才释放 |

两个测试缝，都不碰生产代码：

- **造 IO 错误**：把 `IDBObjectStore.prototype.put` 改成抛错。真实的失败就是 `QuotaExceededError` 这类 IndexedDB 抛出来的错，注入点越贴近真实现越好。
- **造流式响应**：`test/fakeStream.ts` 换掉全局 `fetch`，手动喂 SSE（`message_start` → `content_block_delta` → 保持不关），URL 拼接、请求头、SSE 解析仍然走真实代码。`test/setup.mjs` 里补了 `requestAnimationFrame`（流式增量按帧批量提交，Node 没有动画帧）。附件上传这一步可以 `useUploads.setState` 直接置成 done，跳过真实上传。

写这类测试的三条硬规矩：

- **数据必须在 `initChat()` 之前造好**：`initChat` 是一次性的，会话清单只读一遍，之后再往库里塞的会话不在清单里，`ensureSessionLoaded` 会直接返回。
- **一个用例一个文件**：`sessionAccess` / `historyEpoch` / `dbPromise` 都是模块级单例，同文件里跑两个用例会互相污染（踩过：第二个用例因为清单没刷新而假失败）。Node 每个测试文件跑在独立进程里，天然干净。
- **不要 mock `db.ts`**：写回纪律、事务、游标都在里面，mock 掉等于把最该测的部分测没了。用 `test/setup.mjs` 里的 `fake-indexeddb` 让真实代码跑起来。
- 判定“测试有没有牙齿”：把被守的那行代码故意改坏，确认对应测试变红，再还原。

**安全审核（v0.9.7 起默认不声明）**：

- `prompt.ts` 的 `SAFETY_CHECK` 现在是 `undefined`，请求体里**不出现** `safety_check` 字段，等价于官方文档的 `level: 'low'`。三个注入点（聊天、分段摘要、合并摘要）都走 `safetyCheckField()`，改一个常量就全开。
- 关它的收益：输出写完就断连（不等审核）、网页抓取不再先过审、审核 token 不再计入 `output_tokens`。
- 代价与边界：**关掉不等于没有拒答** —— 声明了联网工具的请求即使不传该字段也可能以 `stop_reason: 'refusal'` 结束，拒答分支必须一直留着；对外提供服务时按官方要求改回 `{ level: 'high' }`。
- `test/compaction.test.ts` 有一条断言钉住这个默认值：真要改回 high，先改那条测试。


**第 5 项的前提容易踩空**：「继续生成」不是常驻按钮，只有回复被**手动停止**、或撞到输出上限（`stopReason === 'max_tokens'`）时才出现。正常答完的回复不给续写——这是设计，不是 bug。所以必须先停一次。

实战量级（v0.9.10 回归）：400 字的请求 5 秒内就写完了，抓不住停止时机；要用 **3000 字量级**的请求，第 6 秒左右点停止才稳。停止后文本会停在半个句子上，点「继续生成」应从这里原样接续、不重复已写内容。

**第 7 项的平台限制（别当成 bug 去"修"）**：安卓只允许应用把**每条屏幕边缘最多 200dp** 从系统返回手势里排除掉，且实测（Android 16 / MIUI V816）这一段被系统锚定在**屏底**。所以：

```text
mSystemGestureExclusion=SkRegion((0,1190,48,1590))   # 上报整高 48px 宽，系统只留屏底 400px = 200dp
```

- 屏底 200dp：贴物理边缘右滑能进应用（`MainActivity` 的 `setSystemGestureExclusionRects`）
- 屏幕中段/上段：贴边右滑仍会被系统当成「返回」，应用拿不到这条手势
- 因此真正可用的一层在网页里（`src/app/siderSwipe.ts`）：起手位置不限（开合都行，只避开输入框、可横向滚动的内容和所有浮层）、横向位移 ≥45dp（≈0.71cm，300dp 抽屉的 0.15）、方向必须在 400ms 内判出

**第 7 项的跟手是怎么做到的（别改回布尔开关）**：抽屉位置不再由 `open` 布尔驱动，而是 `mobileSiderState.ts` 里一个 0→1 的进度，拖动时直接写元素的 `--sider-x` 和遮罩 `opacity`，**不经过 React**；松手后 `settleSider()` 才让 CSS transition 收敛。改动前后的实测（US95VW7T9LEQNBBI，探针用 `performance.now()`）：

```text
改前：越阈 → 挂载完成 449ms → 首帧 11ms   （React 更新被连续 touchmove 饿死，松手才提交）
改后：拖动首帧 → 绘制 1ms；抽屉常驻挂载给启动只加 30ms 渲染 + 9ms 绘制
```

抽屉必须**常驻挂载**（收起时 `transform: translate3d(-100%, 0, 0)`），否则第一次拖动又要现挂会话列表，跟手就废了。

**第 7 项的流畅度是怎么保住的（三处都别再改回去）**：

| 别做的事 | 为什么 | 实测 |
|---|---|---|
| 用自定义属性 `--sider-x` 驱动 transform | 自定义属性会往下继承，每帧都要把整棵会话列表的样式重算一遍 | 拖动 54 帧 / 90 分位 28ms / 卡顿 7.4% |
| 在每帧的 `touchmove` 里 `getComputedStyle` 走祖先链（`usePreventPageScroll`） | 强制同步结算样式，等于每帧一次全量样式重算 | 同上，合并修复后 90 分位回到 12ms |
| 在起手/收敛那一帧切 `aria-hidden`、`inert`、`visibility` | Chromium 要重建无障碍子树，会话列表这个体量上是一次几百毫秒的主线程长任务 | 收敛动画只剩 1 帧 / 133ms 间隔 |
| 用 CSS `transition` 做收敛动画 | Chrome 在动画开始时预栅格化整层 | 每次开启一次 250ms 尖峰 |

正解：`transform` + `opacity` 直接写元素，收敛动画自己用 rAF 补间（`easeOutCubic`，220ms），和拖动共用同一个 `paint()`。

**松手判定是「从起手那一侧算距离」，不是「进度过半」**（别改回去）：

```text
COMMIT_TRAVEL = 0.15 抽屉宽      300dp 抽屉 → 45dp ≈ 0.71cm 就换状态
MIN_TRAVEL = 32dp                再短一律回弹，防指尖抖动
FLING_VELOCITY = 0.35 px/ms      快速轻扫也换（方向必须和位移一致）
target === closing 时保持不动     抽屉开着时向右拖不会把它关掉
```

写成「进度过半」会出现两个坑：一是开合各需要抽屉宽度的一半（300dp 抽屉要 2.4cm，手感发沉）；
二是同一个进度阈值用在收起方向等于要求拖过 73%，反而更难关，而且向右拖也会误关。
真机实测（每种情况冷启动）：0.6cm 回弹，0.71cm / 0.9cm 开合都成立；起手位置从左到右、方向从开到关，四条完全对称。手感嫌重就只调这一个常数，别动方向判定。

量法（gfxinfo 对 WebView 的 rAF 动画不准，要用页内探针）：

```powershell
adb shell dumpsys gfxinfo com.dschat.app reset
adb shell input swipe 60 820 360 820 2000      # 拖动
adb shell dumpsys gfxinfo com.dschat.app | Select-String "Total frames|Janky|percentile"
```

```text
目标：拖动 ≥240 帧 / 90 分位 ≤12ms / 卡顿帧 ≤0.5%
收敛：页内 PerformanceObserver 的 longtask 必须为空，rAF 间隔 p90 = 17ms
```


---

## 5. 跨环境抽查（四个维度）

| 维度 | 做法 | 看什么 |
|---|---|---|
| 浅色主题 | 设置 → 浅色 | 面板边框、气泡、代码块、Toast 对比度 |
| English | 设置 → English | 文案截断、按钮变宽后是否压线 |
| 旋转设备 | 打开系统「自动旋转」后把手机横过来 | **界面保持竖屏不变**（`android:screenOrientation="portrait"`，对齐官方 App）；侧边栏、输入框不重排 |
| 小屏 | `adb shell wm size 640x1440` + `adb shell wm density 320`（还原：`wm size reset` / `wm density reset`） | 文字换行、按钮是否贴边 |

> 小屏最容易暴露间距问题——720 宽下看着正常的"文字贴按钮""按钮贴边框"，换尺寸就现形。

---

## 6. 产物核对

```powershell
# APK 归档 + 桌面副本
Copy-Item android\app\build\outputs\apk\release\app-release.apk ..\apk-archive\DS-Chat-vX.Y.Z.apk
Copy-Item android\app\build\outputs\apk\release\app-release.apk ..\DS-Chat-vX.Y.Z.apk

# 哈希必须与构建产物一致（证明装机的就是这个包）
Get-FileHash ..\DS-Chat-vX.Y.Z.apk -Algorithm SHA256
Get-FileHash android\app\build\outputs\apk\release\app-release.apk -Algorithm SHA256

# 设备上的版本
adb shell dumpsys package com.dschat.app | Select-String 'versionName|versionCode'
```

---

## 7. 提交与标签

- 一个版本一个提交，提交信息带 `(vX.Y.Z)`
- 提交信息用文件 + `git commit -F`（避免 PowerShell 引号问题）
- 打 tag：`git tag vX.Y.Z`
- **不推送 `origin`**（除非明确要求）

---

## 8. 证据目录

发版时在 `apk-archive/vX.Y.Z-evidence/` 放：

- 十项手工回归的截图
- `pnpm test` 的完整输出
- APK 的 sha256 与设备上的 versionName

这样"验过了"不只是一句话，而是能翻出来看的东西。
