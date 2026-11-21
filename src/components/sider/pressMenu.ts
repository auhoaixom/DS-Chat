/**
 * 长按弹菜单的手势裁决。
 *
 * 同一次长按，WebView 会送出好几路事件：我们自己的 450ms 计时器、系统补发的
 * `contextmenu`、松手后补发的 `click`。**谁先谁后各机型不一样** —— 实测小米上系统那份
 * 来得早（等于先 toggle 打开，计时器随后再打开一次，看不出来），华为上计时器先到
 * （菜单已开），系统那份再来一次 toggle 就把它关掉了，于是「弹窗一闪而过」。
 *
 * 所以不能用「多久之内算同一次手势」这种时间窗口来判断（v1.0.0 用的是 400ms）：
 * 手指按得久一点窗口就过期了，松手那一下同样会把菜单关掉。
 *
 * 这里只认「这一次按下的手势」，与时间无关。
 */
export type PressMenu = {
  /** 新手势按下：上一次手势没被消费掉的「待吞」作废 */
  pressStart: () => void
  /** 这次手势已经把菜单弹出来了（长按到点，或系统补发的 contextmenu） */
  opened: () => void
  /** 松手后补发的 click：属于弹出菜单的那次手势就吞掉，之后的点击才是用户真的点了 */
  takeClick: () => boolean
}

export const createPressMenu = (): PressMenu => {
  let armed = false
  return {
    pressStart: () => {
      armed = false
    },
    opened: () => {
      armed = true
    },
    takeClick: () => {
      const taken = armed
      armed = false
      return taken
    },
  }
}
