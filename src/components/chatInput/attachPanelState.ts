import { create } from 'zustand'

/**
 * 输入框右下角「＋」的附件面板。
 * 面板插在输入框下方、和键盘争同一块位置，所以状态放在共享 store 里：
 * 返回键要能先关它，会话页与欢迎页也要据此隐藏底部免责声明。
 */
type AttachPanelState = { open: boolean }

const useAttachPanelStore = create<AttachPanelState>(() => ({ open: false }))

export const useAttachPanelOpen = () => useAttachPanelStore((state) => state.open)

export const isAttachPanelOpen = () => useAttachPanelStore.getState().open

export const closeAttachPanel = () => useAttachPanelStore.setState({ open: false })

export const toggleAttachPanel = () =>
  useAttachPanelStore.setState((state) => ({ open: !state.open }))
