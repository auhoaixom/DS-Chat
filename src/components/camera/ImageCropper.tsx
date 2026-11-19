import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import { finishCrop, useCropRequest } from './cropState.js'
import styles from './ImageCropper.module.css'

type Rect = { x: number; y: number; w: number; h: number }
/** 四角调整两条边，四边只调整一条，move 为整体平移 */
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'

type Drag = {
  mode: DragMode
  startX: number
  startY: number
  origin: Rect
}

/** 裁剪框相对图片的归一化坐标：默认铺满整张图，也就是「不裁剪」 */
const DEFAULT_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 }
/** 裁剪框最小边长（占图片比例） */
const MIN_SIZE = 0.1

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** 判定「没实际裁剪」：默认铺满整张图，用户没动过就直接用原图，避免无谓的重新编码 */
const isFullRect = ({ x, y, w, h }: Rect) => x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999

/** 根据拖动的角或整体平移，算出新的裁剪框，并保证不出图、不小于最小尺寸。 */
const applyDrag = (origin: Rect, mode: DragMode, dx: number, dy: number): Rect => {
  if (mode === 'move') {
    return {
      ...origin,
      x: clamp(origin.x + dx, 0, 1 - origin.w),
      y: clamp(origin.y + dy, 0, 1 - origin.h),
    }
  }
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.w
  let bottom = origin.y + origin.h
  if (mode.includes('w')) {
    left = clamp(origin.x + dx, 0, right - MIN_SIZE)
  }
  if (mode.includes('e')) {
    right = clamp(origin.x + origin.w + dx, left + MIN_SIZE, 1)
  }
  if (mode.includes('n')) {
    top = clamp(origin.y + dy, 0, bottom - MIN_SIZE)
  }
  if (mode.includes('s')) {
    bottom = clamp(origin.y + origin.h + dy, top + MIN_SIZE, 1)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 拍照后的裁剪界面：全屏预览 + 可拖动的裁剪框，四角调整大小，框内拖动整体平移。
 * 点「完成」按原图像素裁出结果；点「取消」放弃这张照片。
 */
export const ImageCropper = () => {
  const t = useTranslate()
  const request = useCropRequest()
  const [url, setUrl] = useState<string | null>(null)
  const [rect, setRect] = useState<Rect>(DEFAULT_RECT)
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    if (!request) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(request.file)
    setUrl(objectUrl)
    setRect(DEFAULT_RECT)
    return () => URL.revokeObjectURL(objectUrl)
  }, [request])

  // 手势统一挂在 window 上：手指移出裁剪框或屏幕边缘时依然跟手
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const stage = stageRef.current
      if (!drag || !stage) {
        return
      }
      const box = stage.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) {
        return
      }
      const dx = (event.clientX - drag.startX) / box.width
      const dy = (event.clientY - drag.startY) / box.height
      setRect(applyDrag(drag.origin, drag.mode, dx, dy))
    }
    const stop = () => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  if (!request || !url) {
    return null
  }

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, origin: rect }
  }

  const confirm = () => {
    const image = imageRef.current
    if (!image) {
      finishCrop(null)
      return
    }
    // 没动过裁剪框就直接用原图，避免重新编码带来的质量损失
    if (isFullRect(rect)) {
      finishCrop(request.file)
      return
    }
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    const sx = Math.round(rect.x * naturalWidth)
    const sy = Math.round(rect.y * naturalHeight)
    const width = Math.max(1, Math.round(rect.w * naturalWidth))
    const height = Math.max(1, Math.round(rect.h * naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      finishCrop(request.file)
      return
    }
    context.drawImage(image, sx, sy, width, height, 0, 0, width, height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          finishCrop(request.file)
          return
        }
        finishCrop(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92
    )
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('cropTitle')}>
      <div className={styles.header}>
        <button type="button" className={styles.headerButton} onClick={() => finishCrop(null)}>
          {t('cancel')}
        </button>
        <span className={styles.title}>{t('cropTitle')}</span>
        <button
          type="button"
          className={styles.headerButton}
          style={{ color: 'var(--dsw-alias-button-primary-fill)' }}
          onClick={confirm}
        >
          {t('cropDone')}
        </button>
      </div>
      <div className={styles.stageWrap}>
        <div ref={stageRef} className={styles.stage}>
          <img className={styles.image} ref={imageRef} src={url} alt={t('cropTitle')} />
          <div
            className={styles.frame}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
            onPointerDown={beginDrag('move')}
          >
            {(['n', 's', 'w', 'e'] as const).map((edge) => (
              <span
                key={edge}
                className={styles.edge}
                data-edge={edge}
                onPointerDown={beginDrag(edge)}
              />
            ))}
            {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <span
                key={corner}
                className={styles.handle}
                data-corner={corner}
                onPointerDown={beginDrag(corner)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.hint}>{t('cropHint')}</div>
    </div>
  )
}
