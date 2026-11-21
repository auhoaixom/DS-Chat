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

## 4. 手工回归（六项，逐项截图）

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
| 8 | 长按菜单与置顶 | 任意会话行**长按 0.5 秒**弹出菜单（没有 ⋯ 按钮）→ 置顶；再长按同一行，菜单应显示「取消置顶」，点它 | 置顶后出现「置顶」分组在最上方且该会话从日期分组消失；取消后回到原来位置（updatedAt 未被污染）；杀掉应用重开仍保持 |

**第 5 项的前提容易踩空**：「继续生成」不是常驻按钮，只有回复被**手动停止**、或撞到输出上限（`stopReason === 'max_tokens'`）时才出现。正常答完的回复不给续写——这是设计，不是 bug。所以必须先停一次。

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

- 六项手工回归的截图
- `pnpm test` 的完整输出
- APK 的 sha256 与设备上的 versionName

这样"验过了"不只是一句话，而是能翻出来看的东西。
