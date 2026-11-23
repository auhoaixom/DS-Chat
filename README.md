# DS Chat

一个用自己 API Key 的安卓聊天客户端，前端直接连 DeepSeek API，没有自己的服务端。

私有自用：不分发、不上架应用商店、不做多端同步。当前版本 `1.4.0`（`versionCode 90`）。

## 这是什么

- 一个 React 前端（React 18 + zustand + TypeScript strict + rspack/SWC）套在 Capacitor 8 的安卓壳里，装到自己手机上用。
- WebView 的页面 origin 固定为 `https://localhost`。这个不能改：`file://` 的 null origin 会让 IndexedDB 直接失效，整个会话存储都保不住。
- 没有账号体系、没有云端备份、没有后端。数据只在本机，API Key 也只在本机；落盘的那部分是密文，见「本地数据加密」。
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

签名读 `android/keystore.properties`（`storeFile` / `storePassword` / `keyAlias` / `keyPassword`）。这个文件**不入库**，缺了它 gradle 只会出未签名的包——装不上，也不该装。

**版本号要改三处**：`package.json` 的 `version`、`android/app/build.gradle` 的 `versionName` 和 `versionCode`。漏改一个不会报错，只会打出一个装不上的包；现在 `pnpm test` 会拦住这种情况（要求 `versionCode` 不小于历史上任何一版，准备发新版时还必须严格大于上一版）。

完整的发版流程（十一项手工回归、产物核对、证据归档）见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。已发布的版本和它们的 APK 见 [RELEASES.md](RELEASES.md)。

## 开发

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发服务器，http://localhost:8090 |
| `pnpm build` | 构建到 `dist/` |
| `pnpm type` | TypeScript 类型检查 |
| `pnpm lint` | oxlint 检查 |
| `pnpm test` | 单元测试（`tsc` 编译后跑 `node --test`） |
| `pnpm android:sync` | `pnpm build` + `cap sync android` |
| `pnpm android:debug` | 构建 debug APK |

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
```

## 功能

- 多会话：自动标题、重命名、删除、置顶，长按会话行打开菜单。
- 侧栏：点 ☰ 或从屏幕边缘滑动打开，反向滑动关闭。
- 回复：流式输出、深度思考（5 行滚动小窗，点标题展开全文、再点收回）、智能搜索与链接阅读、停止与继续生成、编辑提问、重新生成、切换消息分支。
- 附件：底部面板里的相机、相册（含裁剪）、文件；支持粘贴与拖拽。
- 渲染：Markdown、代码高亮、KaTeX 公式、Mermaid 图表。
- 上下文：超长会话自动压缩历史（摘要 + 只读原文），顶部上下文面板显示用量。
- 数据：历史导入导出（ZIP）、设置里显示账户余额、导出前显示进度。
- 加密：会话正文、标题、压缩摘要与 API Key 以硬件密钥加密落盘；图片字节不加密。细节见下文「本地数据加密」。
- 外观：深色/浅色主题、六种界面语言（简体中文 / 繁體中文 / English / 日本語 / Русский / Français）、移动端布局；默认模型 `deepseek-flash`，模型名可在设置里改。
- 位置：设置 → 通用 → 位置信息里可以下拉选省市，也可以点「定位」用手机坐标自动填到市（精度差于 5 公里时拒绝写入并提示）。
- 输入：手机回车默认换行（设置 → 通用 → 个性化键位设置里可切成"直接发送"）；非 flash 模型自动降级为纯对话（不发服务端工具、不请求标题、不注入位置提醒）。

## 数据与存储

- API Key 存在 `localStorage`，值是密文；其余设置（语言、主题、位置、开关）不加密。会话、消息与附件原件存在 IndexedDB。
- 因为 origin 固定为 `https://localhost`，数据不会和其他站点串。
- 历史导入导出是 ZIP：导出包含会话与本地可用的图片原件，**不包含** API Key、应用设置、非图片附件原件；导入会在校验通过后整体替换本地会话与附件。
- 设置 → 数据管理 → 删除所有对话：清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复；API Key 与设置保留，已经上传到 API 服务的文件不受影响。

## 本地数据加密

从 1.4.0 起，落盘的用户数据是密文。

**加密了什么**

- API Key（`localStorage` 里是 `ds2:` 开头的密文）。
- 会话正文、标题、压缩摘要（IndexedDB 里是 `meta` + `body` 两段二进制密文）。
- 算法是 AES-256-GCM，每条记录一个随机 nonce，附加数据用记录 id——把 A 会话的密文挪到 B 会话上解密会直接失败。

**密钥从哪来**

真机上由 `SecureKey` 插件向 Android Keystore 要：硬件里生成一把**不能导出**的包装密钥，用它把一份随机数据密钥加密后存进 `SharedPreferences`。把 `app_webview` 目录连同 `SharedPreferences` 拷到别的机器上，**那把包装密钥并不在文件里**，因此解不开。

设置 → 数据管理 → 诊断信息的摘要第二行会写「密钥来源」：显示「系统安全芯片（Android Keystore）」才算真的硬件保护；显示「软件密钥」说明这台设备没有可用安全硬件，密钥只是存在 `localStorage` 里，安全性等同没有。

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
- 解密失败时数据库**不会删除原记录**，只在界面上报错；设置 → 数据管理里的导出通道始终可用。

## 已知行为，不是 bug

- 深度思考的展开状态是组件内状态，重载页面后回到收起形态。
- 键盘打开时把手机转成横屏会失去输入焦点，与系统输入法的行为一致。
- 手机回车默认换行，想回车即发送要去设置里切（默认值是刻意的：手机上回车键太大，误发比多按一下按钮更烦）。
- 非 flash 模型没有搜索、链接阅读和标题生成 —— 那是服务端按模型开放的能力，App 只是不再发这些字段。
- 版本号三处必须同时改，见上文"出包"。

## 许可

[MIT](LICENSE)，`Copyright (c) 2026 auhoaixom`。

本项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）的改造版，上游版权声明与许可原文保留在 `LICENSE` 的 Upstream notice 段。第三方依赖遵循各自的许可证。

## 其他文档

- [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)：发版检查表，每一版照着走。
- [RELEASES.md](RELEASES.md)：版本台账，tag / `versionCode` / APK / 变更。
- [tools/probe/README.md](tools/probe/README.md)：真机问题怎么用 CDP 探针复现。
- [src/services/chat/history/README.md](src/services/chat/history/README.md)：导入导出格式与保留范围。
