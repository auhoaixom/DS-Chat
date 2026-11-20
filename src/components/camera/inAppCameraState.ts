import { create } from 'zustand'

/** 自建相机的拍摄结果：null 表示取消，其余失败按原因分类交给调用方 */
export type CameraCapture =
  | { file: File }
  | { error: 'denied' | 'unsupported' | 'failed' }
  | null

type CameraRequest = { resolve: (result: CameraCapture) => void }

/** 前后摄像头：记住上次的选择，取消裁剪回到相机时不用重新切换 */
export type CameraFacing = 'environment' | 'user'

type CameraState = { request: CameraRequest | null; facing: CameraFacing }

const useCameraStore = create<CameraState>(() => ({ request: null, facing: 'environment' }))

/**
 * 打开自建相机界面，返回拍到的照片；取消或失败时返回对应结果。
 * 与裁剪界面同样的 Promise 包装，调用方可以串成「拍照 → 裁剪 → 入草稿」的直线流程。
 */
export const openInAppCamera = (): Promise<CameraCapture> =>
  new Promise((resolve) => {
    useCameraStore.setState({ request: { resolve } })
  })

/** 自建相机是否打开（返回键优先关它） */
export const isInAppCameraOpen = () => useCameraStore.getState().request !== null

export const useInAppCameraRequest = () => useCameraStore((state) => state.request)

/** 上次使用的摄像头；相机界面每次打开都从这里恢复 */
export const getCameraFacing = () => useCameraStore.getState().facing

export const setCameraFacing = (facing: CameraFacing) => useCameraStore.setState({ facing })

/** 结束拍摄：result 为照片、错误或取消 */
export const finishInAppCamera = (result: CameraCapture) => {
  const { request } = useCameraStore.getState()
  if (!request) {
    return
  }
  useCameraStore.setState({ request: null })
  request.resolve(result)
}
