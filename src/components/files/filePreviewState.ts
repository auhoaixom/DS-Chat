import { create } from 'zustand'

/**
 * 图片预览层：原生容器里 `<a target="_blank">` 会新开一个没有关闭入口的窗口，
 * 改为应用内全屏遮罩，点击任意处、右上角按钮或返回键都能关闭。
 */
type FilePreviewState = {
  url: string | null
  name: string
  /** 提供时预览层右上角显示裁剪入口；已发送的附件不提供 */
  onCrop?: () => void
  open: (url: string, name: string, onCrop?: () => void) => void
  close: () => void
}

export const useFilePreview = create<FilePreviewState>((set) => ({
  url: null,
  name: '',
  open: (url, name, onCrop) => set({ url, name, onCrop }),
  close: () => set({ url: null, name: '', onCrop: undefined }),
}))
