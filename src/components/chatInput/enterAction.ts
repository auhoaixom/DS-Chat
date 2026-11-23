/**
 * 手机上的回车键该干什么。
 *
 * 早期是"回车即发送"：手机上空格键旁边那个回车很大，很容易在换行时误发。
 * 现在默认换行，想发送就点发送按钮；习惯发送的人可以在设置里切回来。
 *
 * Shift + Enter 恒为换行（外接键盘的通用习惯），输入法组字过程中不拦截 ——
 * 那一次回车是"选词"，不是"提交"。
 *
 * 抽成纯函数：`ChatInput` 只负责把键盘事件翻译成这里的入参。
 */
export type EnterAction = 'newline' | 'send'

export const enterAction = ({
  key,
  shiftKey,
  composing,
  enterNewline,
}: {
  key: string
  shiftKey: boolean
  /** 输入法正在组字（中文拼音、日文假名等） */
  composing: boolean
  /** 设置里的「回车 = 换行」；false 表示回车直接发送 */
  enterNewline: boolean
}): EnterAction | null => {
  if (key !== 'Enter' || composing) {
    return null
  }
  if (shiftKey || enterNewline) {
    return 'newline'
  }
  return 'send'
}
