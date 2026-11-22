/**
 * 找最近的可滚动祖先。
 *
 * 消息列表在桌面和手机上是**两个不同的**滚动层（`.container` / `.scroll`），
 * 组件不该自己去猜，交给这个函数沿祖先链找。
 */
export const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') {
      return el
    }
  }
  return null
}
