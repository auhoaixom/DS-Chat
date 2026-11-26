import { create } from 'zustand'

/**
 * 「离底部够远」：一键回到底部那颗按钮的显隐依据。
 *
 * 为什么是全局 store 而不是 context：写它的是滚动容器（MessageList 里的 scroll 元素），
 * 读它的那颗按钮挂在输入框上方（SessionView 的子树），两者是兄弟关系。走 context 的话
 * 这个每次滚动都可能变的值会把整棵消息树一起带着重渲染，代价太大。
 * 只有一个会话页会挂载这个滚动容器，所以不存在两个实例互相串的情况。
 */
export const useFarFromBottom = create(() => ({ far: false }))

export const setFarFromBottom = (far: boolean) => {
  if (useFarFromBottom.getState().far !== far) {
    useFarFromBottom.setState({ far })
  }
}
