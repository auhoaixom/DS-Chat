# 第三方组件声明

本项目的代码是 MIT（见 [LICENSE](LICENSE)）。但构建出来的 APK 里还包含下面这些第三方组件，
它们各自带自己的许可证和版权声明。分发 APK（比如挂在 GitHub Release 下面）时，这份声明要跟着走。

## 直接运行时依赖

| 组件 | 版本 | 许可证 | 版权 |
|---|---|---|---|
| @capacitor/android | 8.6.2 | MIT | Copyright (c) 2017-present Drifty Co. |
| @capacitor/app | 8.1.2 | MIT | Copyright 2020-present Ionic |
| @capacitor/camera | 8.2.6 | MIT | Copyright 2020-present Ionic |
| @capacitor/core | 8.6.2 | MIT | Copyright (c) 2017-present Drifty Co. |
| @capacitor/filesystem | 8.1.5 | MIT | Copyright (c) 2025 Ionic |
| @capacitor/share | 8.0.3 | MIT | Copyright 2020-present Ionic |
| @capacitor/status-bar | 8.0.4 | MIT | Copyright 2020-present Ionic |
| clsx | 2.1.1 | MIT | Copyright (c) Luke Edwards |
| fflate | 0.8.3 | MIT | Copyright (c) Arjun Barrett |
| idb | 8.0.3 | MIT | Copyright (c) 2016, Jake Archibald |
| katex | 0.16.22 | MIT | Copyright (c) 2013-2020 Khan Academy and other contributors |
| mdast-util-find-and-replace | 3.0.2 | MIT | Copyright (c) Titus Wormer |
| mdast-util-from-markdown | 2.0.3 | MIT | Copyright (c) Titus Wormer |
| mdast-util-gfm | 3.1.0 | MIT | Copyright (c) Titus Wormer |
| mdast-util-math | 3.0.0 | MIT | Copyright (c) 2020 Titus Wormer |
| mermaid | 11.10.1 | MIT | Copyright (c) 2014-2022 Knut Sveidqvist |
| micromark-extension-gfm | 3.0.0 | MIT | Copyright (c) 2020 Titus Wormer |
| micromark-extension-llm-math | 3.1.0 | MIT | Copyright (c) 2020 Titus Wormer |
| prismjs | 1.30.0 | MIT | Copyright (c) 2012 Lea Verou |
| react | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| react-dom | 18.3.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| zustand | 4.4.7 | MIT | Copyright (c) 2019 Paul Henschel |

每一份 MIT 许可证的完整正文在装好依赖后的 `node_modules/<组件名>/LICENSE` 里。

## 上游项目

本项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）的改造版，
上游的版权声明与许可证原文保留在 [LICENSE](LICENSE) 的 Upstream notice 段。

## 不在上面的东西

- `@types/*`（React、KaTeX、Prism、mdast 的类型声明）只在编译期使用，**不进入产物**。
- 上面只列了直接依赖。它们自己还依赖别的包（比如 mermaid 的 d3、dagre），那些包各自带自己的
  MIT / ISC 许可证，声明在各自包的 `LICENSE` 里；这些许可证互不冲突，也不要求额外动作。
- KaTeX 随包分发的字体（`KaTeX_Main` 等）由 KaTeX 项目以 MIT 提供，已包含在上表的 KaTeX 条目里。

## 名称与标志

`DS Chat`、`DSC` 字标与 `design/wordmark.png`、`assets/icon.png` 是本项目的标识，**不在上述任何
许可证的授权范围内**。「DeepSeek」及其标志是深度求索的商标，本项目与其没有隶属或背书关系。
