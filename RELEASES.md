# 版本台账

每个发版 tag 一行，用来回答三个问题：这一版是什么、它的 APK 在哪、它改了什么。

- **版本**列就是 tag 名，`git show vX.Y.Z` 可直接复核。
- **versionCode** 取自该 tag 上的 `android/app/build.gradle`，只增不减。
- **APK** 列：`有` 表示 `apk-archive/DS-Chat-vX.Y.Z.apk` 存在；`未归档` 表示发过版但没留包；`—` 表示该版本还没有安卓端。
- **变更**列取自该 tag 指向提交的标题，不做转述，避免和真实历史脱节。
- 每一版的证据（回归截图、`pnpm test` 输出、APK 的 SHA256）在 `apk-archive/vX.Y.Z-evidence/REPORT.md`。

新发一版时，在表格顶部追加一行即可。

| 版本 | 日期 | versionCode | APK | 变更 |
|---|---|---|---|---|
| v1.4.6 | 2026-11-25 | 96 | 有 | feat: show the DSc splash on launch, and keep it up until the chats are loaded (v1.4.6) |
| v1.4.5 | 2026-11-24 | 95 | 有 | feat: black dsc icon, logo on the welcome screen, and no white flash on launch (v1.4.5) |
| v1.4.4 | 2026-11-24 | 94 | 有 | fix: one generic sentence instead of per-vendor paths (v1.4.4) |
| v1.4.3 | 2026-11-24 | 93 | 有 | fix: give each vendor a real path, and only jump where we know the page works (v1.4.3) |
| v1.4.2 | 2026-11-24 | 92 | 有 | fix: point "run in background" at the app info page instead of guessing vendor settings (v1.4.2) |
| v1.4.1 | 2026-11-24 | 91 | 有 | feat: keep generating in the background and continue after a dropped connection (v1.4.1) |
| v1.4.0 | 2026-11-23 | 90 | 有 | feat: encrypt session bodies and the API Key with a hardware-backed key |
| v1.3.2 | 2026-11-23 | 89 | 有 | fix: drop the "imported" line once the picker no longer matches it |
| v1.3.1 | 2026-11-23 | 88 | 有 | feat: pin a no-location choice in the province and city pickers |
| v1.3.0 | 2026-11-23 | 87 | 有 | feat: fill the province and city from the phone's location |
| v1.2.3 | 2026-11-23 | 86 | 有 | fix: fade out from the dialogs' own close buttons too |
| v1.2.2 | 2026-11-23 | 85 | 有 | fix: fade the settings away, and stop the second nav highlight |
| v1.2.1 | 2026-11-23 | 84 | 有 | fix: keep the status bar themed after the window is re-decorated |
| v1.2.0 | 2026-11-23 | 83 | 有 | feat: fix the vivo focus loop, add four languages, and make Enter a newline |
| v1.1.3 | 2026-11-23 | 82 | 有 | fix: drop focus when the keyboard is dismissed |
| v1.1.2 | 2026-11-23 | 81 | 有 | fix: keep the keyboard when toggling thinking or search |
| v1.1.1 | 2026-11-23 | 80 | 有 | fix: keep the viewport still when the thinking block expands |
| v1.1.0 | 2026-11-23 | 79 | 有 | feat: show thinking in a scrolling window instead of a wall of text |
| v1.0.2 | 2026-11-22 | 78 | 有 | fix: keep the viewport still when the originals collapse |
| v1.0.1 | 2026-11-22 | 77 | 有 | fix: stop closing the long-press menu with the same gesture |
| v1.0.0 | 2026-11-22 | 76 | 有 | release: 1.0.0 |
| v0.9.25 | 2026-11-22 | 75 | 有 | feat: version what we store, and migrate on read |
| v0.9.24 | 2026-11-22 | 74 | 有 | perf: mount the compacted originals from the top, a screen at a time |
| v0.9.23 | 2026-11-22 | 73 | 有 | refactor: extract the message-window clamp so it can be tested |
| v0.9.22 | 2026-11-22 | 72 | 有 | fix: let the unpack counter actually reach the total |
| v0.9.21 | 2026-11-22 | 71 | 有 | fix: report the final session count, and stop mixing 会话/对话 |
| v0.9.20 | 2026-11-22 | 70 | 有 | feat: show progress while exporting and importing the whole history |
| v0.9.19 | 2026-11-22 | 69 | 有 | fix: call the export button what it does, and stop reporting a cancel as failure |
| v0.9.18 | 2026-11-22 | 68 | 有 | fix: never let the message window shrink below one screen |
| v0.9.17 | 2026-11-22 | 67 | 有 | perf: only mount the tail of a conversation, load older on scroll |
| v0.9.16 | 2026-11-22 | 66 | 有 | perf: let the browser skip laying out offscreen messages |
| v0.9.15 | 2026-11-22 | 65 | 有 | fix: stop re-rendering the whole session list on every sider render |
| v0.9.14 | 2026-11-22 | 64 | 有 | fix: diagnostics shows the compaction saving instead of before to after |
| v0.9.13 | 2026-11-22 | 63 | 有 | fix: stop showing the two compaction token numbers on the card |
| v0.9.12 | 2026-11-22 | 62 | 有 | feat: carry compaction and per-reply usage in our own export |
| v0.9.11 | 2026-11-22 | 61 | 有 | test: pin refusal, usage merge and write-back with tests |
| v0.9.10 | 2026-11-21 | 60 | 有 | fix: the running compaction card no longer overflows its own width |
| v0.9.9 | 2026-11-21 | 59 | 有 | fix: hide the summary row when there is no compaction |
| v0.9.8 | 2026-11-21 | 58 | 有 | feat: three-row context panel in K units |
| v0.9.7 | 2026-11-21 | 57 | 有 | feat: stop sending safety_check, document what that costs and keeps |
| v0.9.6 | 2026-11-21 | 56 | 有 | fix: make the context meter add up to what the server actually billed |
| v0.9.5 | 2026-11-21 | 55 | 有 | refactor: trim the diagnostics report to what actually helps |
| v0.9.4 | 2026-11-21 | 54 | 未归档 | fix: outside taps only dismiss overlays, app-wide |
| v0.9.3 | 2026-11-21 | 53 | 未归档 | style: anchor the chat menu to the right edge of the row |
| v0.9.2 | 2026-11-21 | 52 | 未归档 | fix: outside tap only closes the menu, and give rows three states |
| v0.9.1 | 2026-11-21 | 51 | 未归档 | feat: open the chat menu by long-pressing the row |
| v0.9.0 | 2026-11-21 | 50 | 未归档 | feat: pin conversations to the top of the sider |
| v0.8.9 | 2026-11-21 | 49 | 未归档 | feat: keep the app portrait when the device rotates |
| v0.8.8 | 2026-11-21 | 48 | 未归档 | feat: drop the swipe distance to 0.71cm |
| v0.8.7 | 2026-11-21 | 47 | 未归档 | feat: 0.9cm swipe, and a greeting that cannot be selected |
| v0.8.6 | 2026-11-21 | 46 | 未归档 | feat: open the sider from anywhere, with a 1.05cm swipe |
| v0.8.5 | 2026-11-21 | 45 | 未归档 | feat: open and close the sider with a 1.5cm swipe |
| v0.8.4 | 2026-11-21 | 44 | 未归档 | feat: close the sider with a left swipe from anywhere |
| v0.8.3 | 2026-11-21 | 43 | 未归档 | perf: stop the sider from dropping frames while it moves |
| v0.8.2 | 2026-11-21 | 42 | 未归档 | fix: make the sider follow the finger, and let it close the same way |
| v0.8.1 | 2026-11-21 | 41 | 未归档 | feat: open the sider by swiping from the left |
| v0.8.0 | 2026-11-21 | 40 | 有 | feat: let the user type the model name instead of hardcoding it |
| v0.7.12 | 2026-11-21 | 39 | 有 | fix: stop charging 800 tokens for every fetched page |
| v0.7.11 | 2026-11-21 | 38 | 有 | chore: release v0.7.11 |
| v0.7.10 | 2026-11-21 | 37 | 有 | refactor: give the context panel one vertical rhythm |
| v0.7.9 | 2026-11-21 | 36 | 有 | fix: give the hint room above the button in the context panel |
| v0.7.8 | 2026-11-21 | 35 | 有 | fix: re-measure the context panel when compaction starts |
| v0.7.7 | 2026-11-21 | 34 | 有 | fix: measure compaction against one baseline, and start a test suite |
| v0.7.6 | 2026-11-21 | 33 | 有 | refactor: drop the context window picker from settings |
| v0.7.5 | 2026-11-20 | 32 | 有 | feat: keep a way back from render crashes, and export large histories |
| v0.7.4 | 2026-11-20 | 31 | 有 | feat: show the account balance in settings |
| v0.7.3 | 2026-11-20 | 30 | 有 | feat: reuse the chat prefix when summarizing, and show the session cache hit rate |
| v0.7.2 | 2026-11-20 | 29 | 有 | feat: reject non-shrinking summaries, add read-only originals view |
| v0.7.1 | 2026-11-20 | 28 | 有 | feat: keep compacting from the last checkpoint, add a header context meter |
| v0.7.0 | 2026-11-20 | 27 | 有 | feat: compact context by summarizing older messages |
| v0.6.0 | 2026-11-20 | 26 | 有 | feat: recent photos strip in the attach panel |
| v0.5.0 | 2026-11-20 | 25 | 有 | feat: merge camera and file into one ＋ with a bottom attach panel |
| v0.4.4 | 2026-11-20 | 24 | 有 | fix: enlarge the attachment thumbnail so the delete hotspot sits away from the centre |
| v0.4.3 | 2026-11-20 | 23 | 有 | fix: stop the attachment tile from turning a center tap into a delete |
| v0.4.2 | 2026-11-20 | 22 | 有 | fix: make the preview buttons visible on bright images |
| v0.4.1 | 2026-11-20 | 21 | 有 | fix: smooth camera startup, drop the “正在打开相机…” placeholder |
| v0.4.0 | 2026-11-20 | 20 | 有 | feat: in-app camera |
| v0.3.11 | 2026-11-20 | 19 | 有 | fix: copy through the native clipboard so long-press does not depend on WebView focus |
| v0.3.10 | 2026-11-20 | 18 | 有 | fix: theme-matched system bars, single copy toast, inline $$ math, thinking collapse |
| v0.3.9 | 2026-11-20 | 17 | 有 | feat: crop album photos from the preview overlay |
| v0.3.8 | 2026-11-20 | 16 | 有 | feat: return to camera after cancelling crop |
| v0.3.7 | 2026-11-20 | 15 | 有 | fix: make the crop box cover the whole photo by default |
| v0.3.6 | 2026-11-20 | 14 | 有 | feat: resize crop box by dragging its edges |
| v0.3.5 | 2026-11-20 | 13 | 有 | feat: add crop step after taking a photo |
| v0.3.4 | 2026-11-20 | 12 | 有 | feat: replace system photo dialog with in-app action sheet |
| v0.3.1 | 2026-11-20 | 9 | 有 | fix: always show attachment remove button and align camera icon |
| v0.3.0 | 2026-11-20 | 8 | 有 | feat: add camera and gallery picker |
| v0.2.5 | 2026-11-20 | 7 | 有 | feat: rebuild as Android app DS Chat v0.2.5 |
| v0.1.2 | 2026-11-19 | — | — | chore: release v0.1.2 |
| v0.1.1 | 2026-11-13 | — | — | fix: clarify history import errors and release v0.1.1 |
| v0.1.0 | 2026-11-13 | — | — | Initial commit |

## 说明

- `v0.1.0`–`v0.1.2` 是网页版时期，还没有安卓端，所以没有 `versionCode`，也没有 APK。
- `v0.8.1`–`v0.9.4` 是安卓端，但当时没留归档包；这几版的源码仍可用 `git show vX.Y.Z` 取到，需要装机复现时按 `RELEASE-CHECKLIST.md` 重新构建即可（行为与当时的提交一致，签名用现在的证书）。
- `versionCode` 10、11 没有对应 tag，是 `v0.3.1` 与 `v0.3.4` 之间的中间构建，不需要补。
