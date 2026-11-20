/** 相机无法打开的原因：权限被拒 / 设备没有可用摄像头 / 其他失败 */
export type CameraStreamError = 'denied' | 'unsupported' | 'failed'

export interface CameraHandle {
  stream: MediaStream
  /** 设备是否支持手电筒（多数后置摄像头支持，前置一般不支持） */
  torchSupported: boolean
  setTorch(on: boolean): Promise<boolean>
  close(): void
}

/** 把 getUserMedia 抛出的错误归类，调用方据此决定提示还是回退系统相机 */
export const classifyCameraError = (error: unknown): CameraStreamError => {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'NotSupportedError':
    case 'TypeError':
      return 'unsupported'
    default:
      return 'failed'
  }
}

/**
 * 依次放宽约束重试：机型对分辨率与 facingMode 的支持差异很大，
 * 但权限被拒时立刻停下，不要反复弹系统授权框。
 */
const openStream = async (facing: 'environment' | 'user'): Promise<MediaStream> => {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) {
    throw new DOMException('getUserMedia is unavailable', 'NotSupportedError')
  }
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    },
    { audio: false, video: { facingMode: { ideal: facing } } },
    { audio: false, video: true },
  ]
  let last: unknown = null
  for (const constraints of attempts) {
    try {
      return await media.getUserMedia(constraints)
    } catch (error) {
      last = error
      if (classifyCameraError(error) === 'denied') {
        break
      }
    }
  }
  throw last ?? new Error('camera unavailable')
}

/** 打开摄像头并返回可关闭的句柄；失败时抛出原始错误交给 classifyCameraError */
export const openCameraStream = async (facing: 'environment' | 'user'): Promise<CameraHandle> => {
  const stream = await openStream(facing)
  const track = stream.getVideoTracks()[0]
  const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
  const torchSupported = Boolean(track && capabilities?.torch)
  return {
    stream,
    torchSupported,
    async setTorch(on: boolean): Promise<boolean> {
      if (!track || !torchSupported) {
        return false
      }
      try {
        await track.applyConstraints({
          advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
        })
        return true
      } catch {
        return false
      }
    },
    close() {
      for (const item of stream.getTracks()) {
        item.stop()
      }
    },
  }
}

/** 长边上限：2048 已经够看清题目，文件大小与系统相机 quality 85 相当 */
const MAX_EDGE = 2048

/** 抓取当前视频帧并编码成 JPEG，前摄预览是镜像的，抓图同样镜像回去 */
export const captureFrame = async (
  video: HTMLVideoElement,
  mirrored: boolean
): Promise<File> => {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) {
    throw new Error('camera frame is not ready')
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('canvas is unavailable')
  }
  if (mirrored) {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  )
  if (!blob) {
    throw new Error('frame encoding failed')
  }
  return new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
}
