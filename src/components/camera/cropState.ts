import { create } from 'zustand'

/** 一次裁剪请求：待裁剪的文件，以及拿到结果后要兑现的 Promise。 */
export type CropRequest = {
  file: File
  resolve: (file: File | null) => void
}

type CropState = { request: CropRequest | null }

const useCropStore = create<CropState>(() => ({ request: null }))

/**
 * 打开裁剪界面，返回裁剪后的图片；用户取消时返回 null。
 * 用 Promise 包装，调用方可以像普通异步函数一样串在拍照流程里。
 */
export const cropImage = (file: File): Promise<File | null> =>
  new Promise((resolve) => {
    useCropStore.setState({ request: { file, resolve } })
  })

/** 当前是否有裁剪界面打开（返回键优先关闭它）。 */
export const isCropping = () => useCropStore.getState().request !== null

export const useCropRequest = () => useCropStore((state) => state.request)

/** 结束裁剪：result 为裁剪结果，null 表示取消。 */
export const finishCrop = (result: File | null) => {
  const { request } = useCropStore.getState()
  if (!request) {
    return
  }
  useCropStore.setState({ request: null })
  request.resolve(result)
}
