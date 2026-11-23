/**
 * 判断软键盘是不是出现了 / 收起了。
 *
 * 键盘上的「收起」键只把 IME 藏起来，**不会移动焦点** —— 输入框仍然处于聚焦状态，
 * WebView 也不会为此派发任何事件。唯一可靠的信号是可视视口的高度。
 *
 * 判据是**键盘高度**，而且基线是「见过的最大视口高度」，不是 `window.innerHeight`：
 *
 * - 用 `window.innerHeight` 只在键盘覆盖页面时才成立（视口独立变矮）；
 *   一旦系统是"重排"模式（WebView 跟着键盘一起缩），innerHeight 也变小，差值恒为 0，
 *   这条判据就永远不触发——实测红米上就是这种情况。
 * - 用「历史最大视口高度」当基线，两种模式都成立：键盘来时视口变矮、基线不变，
 *   键盘走时视口回到基线。
 * - 相比"高度增量 ≥ 100"，绝对差不会被键盘弹起过程的抖动骗到。早期版本正是用增量，
 *   vivo / OriginOS 上表现为"点输入框，输入法闪一下就消失"（blur → 收起 → 焦点回来 → 再弹）。
 *
 * 转屏会让基线失效（横屏视口本来就矮），由调用方在 `orientationchange` 时重置。
 *
 * 抽成纯函数是为了能单测这些边界（真机测这条代价太高）。
 */

/** 键盘至少这么高才当作"出现了"；比它矮的差值算作工具栏、地址栏之类的起伏 */
export const KEYBOARD_MIN_HEIGHT = 100

/** 聚焦之后这段时间内的视口变化不当作"收起"，避开键盘弹起过程的抖动 */
export const KEYBOARD_SETTLE_MS = 300

/** 键盘高度：基线（无键盘时的视口高度）减去当前视口高度 */
export const keyboardHeight = (baselineHeight: number, viewportHeight: number): number =>
  Math.max(0, baselineHeight - viewportHeight)

/** 键盘是否可见 */
export const keyboardVisible = (baselineHeight: number, viewportHeight: number): boolean =>
  keyboardHeight(baselineHeight, viewportHeight) >= KEYBOARD_MIN_HEIGHT
