<p align="center">
  <img src="assets/icon.png" width="112" alt="DS Chat">
</p>

# DS Chat

> **非官方项目。** 本项目与 DeepSeek（杭州深度求索人工智能基础技术研究有限公司）**没有隶属、合作或背书关系**。
> `DS Chat` 与 `DSC` 字标只是本项目的名字和标志，不代表 DeepSeek 官方；「DeepSeek」及其标志是深度求索的商标。
> 程序调用的是 DeepSeek 公开的 API，需要你自己在 [platform.deepseek.com](https://platform.deepseek.com) 申请 API Key。

一个自带 API Key 的安卓聊天客户端：React 前端直接连 DeepSeek API，没有自己的服务端，数据只在本机。

当前版本 `1.6.8`（`versionCode 108`）。MIT 许可，欢迎 issue 与 PR。

## 这是什么

- 一个 React 前端（React 18 + zustand + TypeScript strict + rspack/SWC）套在 Capacitor 8 的安卓壳里，打包成 APK 装到手机上。
- WebView 的页面 origin 固定为 `https://localhost`。这个不能改：`file://` 的 null origin 会让 IndexedDB 直接失效，整个会话存储都保不住。
- 没有账号体系、没有云端备份、没有后端、没有统计与崩溃上报。数据只在本机，API Key 也只在本机；落盘的那部分是密文，见「本地数据加密」。
- 不发布到应用商店：自己构建、自己签名、自己装（见「出包」）。
- 它不做的事：语音输入与朗读（早期版本有，已移除，相关代码不再存在）、多设备同步、应用内计费。

## 出包

前置：Node.js 22、JDK 21、Android SDK（`platform-tools` 与 `build-tools`）。

```powershell
pnpm install
pnpm build                      # 前端产物进 dist/
npx cap sync android            # dist/ 同步进 android/app/src/main/assets/public/
cd android
.\gradlew.bat assembleRelease --console=plain
adb install -r app\build\outputs\apk\release\app-release.apk
```

签名读 `android/keystore.properties`（`storeFile` / `storePassword` / `keyAlias` / `keyPassword`）。这个文件**不入库**，自己用 `keytool` 生成一份；缺了它 gradle 只会出未签名的包——装不上，也不该装。

**先出开发包，再出正式包**：`.\gradlew.bat assembleDebug` + `adb install -r app\build\outputs\apk\debug\app-debug.apk`。开发包与正式包同包名、同签名（`buildTypes.debug` 长期挂着 `signingConfig signingConfigs.release`），所以能直接覆盖已装的正式版，会话数据与 Keystore 里的数据密钥都保留；版本名自动带 `-dev` 后缀。改动先装开发包试用，确认没问题才出正式包，版本号只在真正发版时才推进。细节见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) §3。

**版本号要改三处**：`package.json` 的 `version`、`android/app/build.gradle` 的 `versionName` 和 `versionCode`。漏改一个不会报错，只会打出一个装不上的包；现在 `pnpm test` 会拦住这种情况（要求 `versionCode` 不小于历史上任何一版，准备发新版时还必须严格大于上一版）。

完整的发版流程（十二项手工回归、产物核对、证据归档）见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。已发布的版本见 [RELEASES.md](RELEASES.md)。改界面前先看 [STANDARDS.md](STANDARDS.md)（界面规矩与坑台账，配 `tools/probe/99k-ui-rules.mjs` 可机检）。

## 开发

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发服务器，http://localhost:8090 |
| `pnpm build` | 构建到 `dist/` |
| `pnpm type` | TypeScript 类型检查 |
| `pnpm lint` | oxlint 检查 |
| `pnpm test` | 单元测试（`tsc` 编译后跑 `node --test`） |
| `pnpm android:sync` | `pnpm build` + `cap sync android` |
| `pnpm android:debug` | 构建 debug APK（发布密钥签名，版本名带 `-dev`） |

`pnpm format` 会重写整个仓库（曾一次改动 180 个文件），别随手跑。

本仓库特有的几个约定：

- CSS Modules 走默认导出（`import styles from './x.module.css'`），不是命名导出。
- `DB_VERSION`（IndexedDB 结构）和 `CONTENT_VERSION`（记录字段语义）是两条独立的版本轴，改哪条都要想清楚旧数据怎么读。
- 改 `android/app/build.gradle` 不要用 `Set-Content`（会写 BOM，gradle 解析失败）。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                六种界面语言的文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储、历史导入导出
    crypto/            本地数据加密：密钥来源、AES-GCM 原语、一次性迁移
    markdown/          Markdown 解析、代码高亮与图表
  utils/               通用工具
test/                  单元测试
tools/probe/           真机问题的 CDP 复现探针
tools/icon/            字标抠图与各密度图标生成
```

## 功能

- 多会话：自动标题、重命名、删除、置顶，长按会话行打开菜单。
- 侧栏：点 ☰ 或从屏幕边缘滑动打开，反向滑动关闭。
- 回复：流式输出、深度思考（5 行滚动小窗，点标题展开全文、再点收回）、智能搜索与链接阅读、停止与继续生成、编辑提问、重新生成、切换消息分支。
- 回到底部：翻上去看历史时，输入框右上方会浮出一颗圆按钮，点一下带一段动画滑回最新消息。
- 附件：底部面板里的相机、相册（含裁剪）、文件；支持粘贴与拖拽。
- 渲染：Markdown、代码高亮、KaTeX 公式、Mermaid 图表。
- 上下文：超长会话自动压缩历史（摘要 + 只读原文）；原文按 5 轮一批、点了才展开，顶部上下文面板显示用量。
- 数据：历史导入导出（ZIP）、设置里显示账户余额、导出前显示进度。
- 加密：会话正文、标题、压缩摘要与 API Key 以硬件密钥加密落盘；图片字节不加密。细节见下文「本地数据加密」。
- 外观：深色/浅色主题、六种界面语言（简体中文 / 繁體中文 / English / 日本語 / Русский / Français）、移动端布局；默认模型 `deepseek-flash`，模型名可在设置里改。
- 位置：设置 → 语言与地区 → 位置信息里可以下拉选省市，也可以点「定位」用手机坐标自动填到市（精度差于 5 公里时拒绝写入并提示）。
- 输入：手机回车默认换行（设置 → 聊天与后台 → 回车里可切成「直接发送」）；非 flash 模型自动降级为纯对话（不发服务端工具、不请求标题、不注入位置提醒）。
- 后台：生成期间起一个前台服务，切到别的应用或锁屏时继续生成；通知栏显示「正在生成回答…（约 N 字）」。这一路还需要系统放行：设置 → 聊天与后台 → 允许后台运行 → 打开系统设置，在系统设置里找到电池或应用管理，把 DS Chat 的后台运行权限打开。**各家叫法不同、位置也不同，应用只给一句通用指路，不猜具体页面**；只关电池优化在华为上不管用。
- 断流：切网络、信号掉线导致连接断开时，会**自动接着写一次**（把已经写出来的那段当前缀重新请求），不丢内容、不从头重来；再断才报错。
- 花费：每条回复底部显示这一轮花了多少钱，前面标着档位（峰 / 谷 / 混），点开是逐项明细（输入、缓存命中、输出各多少 token、各按什么单价）；顶栏上下文面板里显示本会话合计与价目日期。

## 设置页

点侧边栏的「设置」，滑出（手机上从底部滑出）的窗口里先列六个分类，点进去才是具体设置项，左上角 `<` 或手机返回键退回来。分类名下面那行灰字是这一类的当前状态（模型名、对话数、语言与地点、主题、回车行为、版本号），不看进去也知道现在是什么样；关窗时侧边栏会一起收起。手机上窗口高度固定（`min(窗口高度 - 64px, 540px)`），列表页与子页同一个高度，不跳；六行刚好装下，不用滚。

| 分类 | 里面有什么 | 那一行显示的状态 |
|---|---|---|
| 账户 | API Key、模型、账户余额 | 当前模型名（余额不预取，进子页才查） |
| 数据 | 导入历史、导出全部、删除所有对话 | 本地对话条数 |
| 语言与地区 | 语言（同时决定模型用哪种语言回答）、位置信息 | 语言 · 地点 |
| 个性化 | 主题、上下文用量与压缩（开关）、单条消息花费（开关） | 主题（有开关关着时补一句「已隐藏 N 项」） |
| 聊天与后台 | 回车键行为、允许后台运行 | 回车换行 / 回车直接发送 |
| 关于 | 检测更新、支持作者 | 版本号（`v1.6.0`） |

**检测更新**是手点的：点一下「检查」，App 才去 `api.github.com` 查一次公开的 Release 接口，比一下版本号。不自动查、不后台轮询、结果不落盘，关掉设置就忘。查到有新版本只把链接交出去——点「去更新」交给系统浏览器下载 APK，App 自己不下载、不安装，也不要安装权限；检查失败时给一颗「去发布页看看」，让用户还能自己去 GitHub 看。**支持作者**只是打开仓库页，不会替你点 star（那个状态也读不到）。

再说一遍版本号：它只出现在「关于」那一行的灰字里，窗口底部不再单独写一行。

两个开关只控制显示，不动数据：**上下文用量与压缩**关掉后，顶栏那个圆环入口连同用量明细、手动压缩、撤销压缩、会话合计一起消失（自动压缩照常）；**单条消息花费**关掉后，每条回复底部的金额消失（计费照常记录，会话合计还在）。默认都开着。

**诊断信息不在发行版里**：那是排查用的，普通用户拿到也没有用武之地。要用它得自己打一个带诊断的包：`DSH_DIAGNOSTICS=1 pnpm build`，之后设置 → 数据 里才会多出那一行。

## 花费怎么算

- **只算这个 App 自己发出的请求。** 金额是请求发生那一刻按服务端回报的 token 用量算出来的，并连同当时的单价一起存在消息上。导入的会话、1.4.7 之前留下的消息没有这份记录，所以界面上连金额那一行都不出现——不是 0 元，是「不知道 / 不归这里算」。
- **价目表随代码发布**，人民币、按纳元/ token 存成整数，不联网、不需要你填。官方调价时改表 + 发一版；历史金额按当时的单价快照显示，不重算。
- **峰谷两档**：UTC 01–04、06–10（北京时间 09–12、14–18）为峰，周末与已知法定假日全天谷价，峰价是谷价的两倍。按**请求发起时刻**定档，一笔请求不拆分。
- **压缩也要钱**：压缩历史时的那几次摘要请求会算进会话合计，但不挂在任何一条回复下面。
- **缓存是服务端自动做的**，不需要设置。实测：提示长度到一千多 token 之后才开始命中，之后每轮命中量按 128 token 的块往上长；一次七轮的会话命中率到了 64%，省下约 15% 的钱。
- **用法上的建议**：同一个话题尽量在一个会话里连续聊完——上一轮的整段上下文会按缓存的便宜价走；反过来，只是想问一句独立的小事，开新会话更便宜，别拖着一个几万 token 的老会话。

## 数据与存储

- API Key 存在 `localStorage`，值是密文；其余设置（语言、主题、位置、开关）不加密。会话、消息与附件原件存在 IndexedDB。
- 因为 origin 固定为 `https://localhost`，数据不会和其他站点串。
- 历史导入导出是 ZIP：导出包含会话与本地可用的图片原件，**不包含** API Key、应用设置、非图片附件原件；导入会在校验通过后整体替换本地会话与附件。
- 设置 → 数据 → 删除所有对话：清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复；API Key 与设置保留，已经上传到 API 服务的文件不受影响。

## 本地数据加密

从 1.4.0 起，落盘的用户数据是密文。

**加密了什么**

- API Key（`localStorage` 里是 `ds2:` 开头的密文）。
- 会话正文、标题、压缩摘要（IndexedDB 里是 `meta` + `body` 两段二进制密文）。
- 算法是 AES-256-GCM，每条记录一个随机 nonce，附加数据用记录 id——把 A 会话的密文挪到 B 会话上解密会直接失败。

**密钥从哪来**

真机上由 `SecureKey` 插件向 Android Keystore 要：硬件里生成一把**不能导出**的包装密钥，用它把一份随机数据密钥加密后存进 `SharedPreferences`。把 `app_webview` 目录连同 `SharedPreferences` 拷到别的机器上，**那把包装密钥并不在文件里**，因此解不开。

诊断信息的摘要第二行会写「密钥来源」：显示「系统安全芯片（Android Keystore）」才算真的硬件保护；显示「软件密钥」说明这台设备没有可用安全硬件，密钥只是存在 `localStorage` 里，安全性等同没有。这一行只在诊断构建（`DSH_DIAGNOSTICS=1 pnpm build`）里看得到，发行版没有入口。

**没有加密什么**

- **图片与文件的字节不加密**。拿到数据目录的人能翻出一堆图片，但不知道它们属于哪个对话、不知道文件名、不知道上下文。
- 会话的 `id`、创建/更新时间、置顶标记、引用到的附件 id 留在明文区，因为列表排序和索引要用。
- 导出的 ZIP 是明文（本来就是给你自己保管的）。

**代价（三件都真的会发生）**

- **重装 App 数据必丢**。Keystore 里的密钥跟着应用一起删，密文就再也解不开了。换手机、重装之前一定要先导出备份。
- **不能降级**。装回 1.3.x 读不了已加密的数据，只会看到空白列表。
- **挡不住能运行这个 App 的人**。应用自己得能解密才能显示对话，密钥必然在设备上取得到——这是所有本地加密的共同天花板，root 过的手机也一样。

**升级时的一次性提示**

从旧版本升上来、且库里已有会话时，会先弹一个不可跳过的对话框：说明要发生什么、建议先导出备份、并明确告知不能降级。点「开始加密」才动数据；迁移是分批的，中途杀掉应用，下次启动会从断点接着做（已加密的记录按形状跳过）。

**一个要如实说明的残留**

迁移是**就地覆盖**：旧记录被新密文覆盖。但 Chromium 的 leveldb 不会立刻擦掉旧文件里的字节，所以升级前写下的明文（最要紧的是 API Key）可能还留在 `Local Storage/leveldb` 和历史 `.ldb` 文件里，直到系统自己做 compaction 回收。

这一点在真机上验证过：迁移后 `IndexedDB` 的 1243 条会话记录全部是密文（`recordsStillPlain: 0`），但 `Local Storage/leveldb/000949.ldb` 里仍能搜到升级前的 API Key 明文。

要彻底避开这条，只有两条路：**从 1.4.0 全新安装**（那样从第一次写入起就是密文，不会有残留），或者升级后去服务商后台**换一把新的 API Key**，让残留的那把作废。

**调试怎么办**

加密只发生在写盘前一瞬和读盘后一瞬，中间全是明文：组件状态、导出的 ZIP、分享出去的文件、浏览器里 `pnpm dev` 跑的那份，都是明文。真机上唯一的损失是 DevTools 的 Application 面板里看到的是密文。

- `chrome://inspect` 连上 WebView，在 Console 里用原始 IndexedDB API 读记录，能确认落盘形状（记录里只有 `id/createdAt/updatedAt/fileIds/meta/body`，没有 `title`/`messages`）。
- 排查数据问题一律走「导出 ZIP 到电脑解开看」，那份是明文。
- 解密失败时数据库**不会删除原记录**，只在界面上报错；设置 → 数据里的导出通道始终可用。

## 已知行为，不是 bug

- 深度思考的展开状态是组件内状态，重载页面后回到收起形态。
- 键盘打开时把手机转成横屏会失去输入焦点，与系统输入法的行为一致。
- 手机回车默认换行，想回车即发送要去设置里切（默认值是刻意的：手机上回车键太大，误发比多按一下按钮更烦）。
- 非 flash 模型没有搜索、链接阅读和标题生成 —— 那是服务端按模型开放的能力，App 只是不再发这些字段。
- 版本号三处必须同时改，见上文"出包"。
- 压缩原文的分批展开是手动的：收起再展开回到首批 5 轮，不记住上次展开到哪；这是有意的（挂载量由用户决定）。
- 展开原文时顶部那张压缩卡片会吸顶；但滑过原文块、进入下面的正常对话之后它会收起，这时想收起原文得往回滑。

## 参与

- 提 PR 之前先本地跑 `pnpm type`、`pnpm lint`、`pnpm test`（292 项）。
- 改界面前读一遍 [STANDARDS.md](STANDARDS.md)，它配了可机检的探针 `tools/probe/99k-ui-rules.mjs`。
- 不要跑 `pnpm format`（会重写整仓）。
- 缩进、引号、分号这些别顺手改：仓库里混着两三种风格，统一格式化属于单独一版的工作。

## 许可

[MIT](LICENSE)，`Copyright (c) 2026 auhoaixom`。

本项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）的改造版，上游的版权声明与许可原文保留在 [NOTICE.md](NOTICE.md) 的「上游项目」段。第三方依赖遵循各自的许可证，清单同样在 [NOTICE.md](NOTICE.md)——**分发 APK 时这份声明要跟着走**。

**名称与标志不在 MIT 范围内**：`DS Chat`、`DSC` 字标与 `design/wordmark.png` 是本项目的标识；「DeepSeek」及其标志是深度求索的商标，本仓库不代表也没有获得其背书。要发布自己改的版本，请换一个不与 DeepSeek 混淆的名字和标志。

## 其他文档

- [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)：发版检查表，每一版照着走。
- [RELEASES.md](RELEASES.md)：版本台账，tag / `versionCode` / APK / 变更。
- [tools/probe/README.md](tools/probe/README.md)：真机问题怎么用 CDP 探针复现。
- [src/services/chat/history/README.md](src/services/chat/history/README.md)：导入导出格式与保留范围。

