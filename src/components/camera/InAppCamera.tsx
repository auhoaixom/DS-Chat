import clsx from 'clsx'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  classifyCameraError,
  captureFrame,
  openCameraStream,
  type CameraHandle,
} from '../../services/cameraStream.js'
import { IconCloseOutline16, IconFlashOutline16, IconSwitchCameraOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import {
  finishInAppCamera,
  getCameraFacing,
  setCameraFacing,
  useInAppCameraRequest,
  type CameraFacing,
} from './inAppCameraState.js'
import styles from './InAppCamera.module.css'

/**
 * 自建相机：取景、补光、前后切换、快门都在应用内，
 * 拍完直接进裁剪页，绕开系统相机那个「✗ / ✓」确认页。
 */
export const InAppCamera = memo(function InAppCamera() {
  const request = useInAppCameraRequest()
  // 每次打开都从后置摄像头、关闭补光的状态开始
  if (!request) {
    return null
  }
  return <CameraView />
})

const CameraView = () => {
  const t = useTranslate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<CameraHandle | null>(null)
  const [facing, setFacing] = useState<CameraFacing>(getCameraFacing)
  const [ready, setReady] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [flash, setFlash] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const mirrored = facing === 'user'

  const switchFacing = useCallback(() => {
    setFacing((value) => {
      const next: CameraFacing = value === 'environment' ? 'user' : 'environment'
      setCameraFacing(next)
      return next
    })
  }, [])

  useEffect(() => {
    let disposed = false
    // 在 effect 内取一次节点引用，清理时用的就是这一份
    const video = videoRef.current
    setReady(false)
    setTorchAvailable(false)
    setTorchOn(false)

    openCameraStream(facing)
      .then(async (handle) => {
        if (disposed) {
          handle.close()
          return
        }
        handleRef.current = handle
        setTorchAvailable(handle.torchSupported)
        if (video) {
          video.srcObject = handle.stream
          try {
            await video.play()
          } catch {
            // 自动播放被拦时不阻断：画面依然会随 metadata 就绪而显示
          }
        }
        if (!disposed) {
          setReady(true)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          // 打不开就带着原因退出，由调用方决定提示还是回退系统相机
          finishInAppCamera({ error: classifyCameraError(error) })
        }
      })

    return () => {
      disposed = true
      handleRef.current?.close()
      handleRef.current = null
      if (video) {
        video.srcObject = null
      }
    }
  }, [facing])

  const close = useCallback(() => {
    finishInAppCamera(null)
  }, [])

  const shoot = useCallback(async () => {
    const video = videoRef.current
    if (!video || !ready || capturing) {
      return
    }
    setCapturing(true)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 120)
    try {
      const file = await captureFrame(video, mirrored)
      finishInAppCamera({ file })
    } catch {
      showToast({ key: 'cameraFailed' })
      setCapturing(false)
    }
  }, [capturing, mirrored, ready])

  const toggleTorch = useCallback(async () => {
    const next = !torchOn
    const applied = await handleRef.current?.setTorch(next)
    if (applied) {
      setTorchOn(next)
    } else {
      setTorchAvailable(false)
    }
  }, [torchOn])

  return (
    <div className={clsx(styles.overlay, ready && styles.ready)}>
      <video
        ref={videoRef}
        className={clsx(styles.video, mirrored && styles.mirrored)}
        playsInline
        muted
        autoPlay
      />
      {flash ? <div className={styles.flash} /> : null}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('cameraClose')}
          onClick={close}
        >
          <IconCloseOutline16 />
        </button>
        {torchAvailable ? (
          <button
            type="button"
            className={clsx(styles.iconButton, torchOn && styles.active)}
            aria-label={t('cameraTorch')}
            aria-pressed={torchOn}
            onClick={() => void toggleTorch()}
          >
            <IconFlashOutline16 />
          </button>
        ) : null}
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('cameraSwitch')}
          onClick={switchFacing}
        >
          <IconSwitchCameraOutline16 />
        </button>
        <button
          type="button"
          className={clsx(styles.shutter, (!ready || capturing) && styles.shutterDisabled)}
          aria-label={t('cameraShutter')}
          aria-disabled={!ready || capturing}
          onClick={() => void shoot()}
        >
          <span className={styles.shutterInner} />
        </button>
        <span className={styles.spacer} aria-hidden />
      </div>
    </div>
  )
}
