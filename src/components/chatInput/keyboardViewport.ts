/**
 * 判断软键盘是不是被收起了。
 *
 * 键盘上的「收起」键只把 IME 藏起来，**不会移动焦点** —— 输入框仍然处于聚焦状态，
 * WebView 也不会为此派发任何事件。唯一可靠的信号是可视视口高度变回来：
 * 键盘弹出时视口变矮，收起时恢复。
 *
 * 抽成纯函数是为了能单测这个阈值（真机测这条代价太高）。
 */

/** 视口至少长高这么多像素才算"键盘收起"；更小的起伏当作工具栏收缩之类的抖动 */
export const KEYBOARD_HIDE_THRESHOLD = 100

/** previous / next 是前后两次的 visualViewport.height */
export const keyboardDismissed = (previous: number, next: number): boolean =>
  next - previous >= KEYBOARD_HIDE_THRESHOLD
