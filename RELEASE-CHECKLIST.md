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

**第 5 项的前提容易踩空**：「继续生成」不是常驻按钮，只有回复被**手动停止**、或撞到输出上限（`stopReason === 'max_tokens'`）时才出现。正常答完的回复不给续写——这是设计，不是 bug。所以必须先停一次。

---

## 5. 跨环境抽查（四个维度）

| 维度 | 做法 | 看什么 |
|---|---|---|
| 浅色主题 | 设置 → 浅色 | 面板边框、气泡、代码块、Toast 对比度 |
| English | 设置 → English | 文案截断、按钮变宽后是否压线 |
| 横屏 | `adb shell settings put system user_rotation 1`（还原：`0`） | 头部、输入框、浮层 |
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
