# DS Chat

一个用自己 API Key 的安卓聊天客户端，前端直接连 DeepSeek API，没有自己的服务端。

私有自用：不分发、不上架应用商店、不做多端同步。当前版本 `1.1.3`（`versionCode 82`）。

## 这是什么

- 一个 React 前端（React 18 + zustand + TypeScript strict + rspack/SWC）套在 Capacitor 8 的安卓壳里，装到自己手机上用。
- WebView 的页面 origin 固定为 `https://localhost`。这个不能改：`file://` 的 null origin 会让 IndexedDB 直接失效，整个会话存储都保不住。
- 没有账号体系、没有云端备份、没有后端。数据只在本机，API Key 也只在本机。
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

完整的发版流程（十项手工回归、产物核对、证据归档）见 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)。已发布的版本和它们的 APK 见 [RELEASES.md](RELEASES.md)。

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
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储、历史导入导出
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
- 外观：深色/浅色主题、六种界面语言（简体中文 / 繁體中文 / English / 日本語 / Русский / Français）、移动端布局；默认模型 `deepseek-flash`，模型名可在设置里改。
- 位置：设置 → 通用 → 位置信息里可以下拉选省市，也可以点「定位」用手机坐标自动填到市（精度差于 5 公里时拒绝写入并提示）。
- 输入：手机回车默认换行（设置 → 通用 → 个性化键位设置里可切成"直接发送"）；非 flash 模型自动降级为纯对话（不发服务端工具、不请求标题、不注入位置提醒）。

## 数据与存储

- API Key 与设置存在 `localStorage`；会话、消息与附件原件存在 IndexedDB。
- 因为 origin 固定为 `https://localhost`，数据不会和其他站点串。
- 历史导入导出是 ZIP：导出包含会话与本地可用的图片原件，**不包含** API Key、应用设置、非图片附件原件；导入会在校验通过后整体替换本地会话与附件。
- 设置 → 数据管理 → 删除所有对话：清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复；API Key 与设置保留，已经上传到 API 服务的文件不受影响。

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
