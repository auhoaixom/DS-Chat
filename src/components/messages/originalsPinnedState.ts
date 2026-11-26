import { create } from 'zustand'

/**
 * 压缩卡片此刻要不要吸顶。
 *
 * 语义是「用户还没滑过原文块」。展开原文时卡片会贴在屏幕顶上，方便随时收起；
 * 但用户一旦越过原文块、往下看正常对话，那张卡片就该松手回到列表最顶上，
 * 别挡着内容。想收起原文就往回滑——这是定下的取舍。
 *
 * 写它的是原文块（哨兵滚出视口顶部时），读它的是卡片，两者是兄弟，
 * 所以放在这个只有一个布尔的小 store 里。
 */
export const useOriginalsPinned = create(() => ({ pinned: true }))

export const setOriginalsPinned = (pinned: boolean) => {
  if (useOriginalsPinned.getState().pinned !== pinned) {
    useOriginalsPinned.setState({ pinned })
  }
}
