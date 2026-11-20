import { create } from 'zustand'

/** 手动压缩的确认弹窗：null 表示关闭 */
type CompactionDialogState = { sessionId: string | null }

export const useCompactionDialog = create<CompactionDialogState>(() => ({ sessionId: null }))

export const openCompactionDialog = (sessionId: string) =>
  useCompactionDialog.setState({ sessionId })

export const closeCompactionDialog = () => useCompactionDialog.setState({ sessionId: null })
