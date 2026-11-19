import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseFill14, IconCropOutline16 } from '../base/icons.js'
import { useFilePreview } from './filePreviewState.js'
import styles from './FilePreview.module.css'

/** 全屏图片预览：点击遮罩、关闭按钮或按 Esc 关闭；草稿附件还提供裁剪入口。 */
export const FilePreview = () => {
  const t = useTranslate()
  const url = useFilePreview((state) => state.url)
  const name = useFilePreview((state) => state.name)
  const onCrop = useFilePreview((state) => state.onCrop)
  const close = useFilePreview((state) => state.close)

  useEffect(() => {
    if (!url) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [url, close])

  if (!url) {
    return null
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={close}
    >
      <img className={styles.image} src={url} alt={name} onClick={(event) => event.stopPropagation()} />
      <div className={styles.actions}>
        {onCrop ? (
          <button
            type="button"
            className={styles.button}
            aria-label={t('cropTitle')}
            onClick={(event) => {
              event.stopPropagation()
              onCrop()
            }}
          >
            <IconCropOutline16 />
          </button>
        ) : null}
        <button type="button" className={styles.button} aria-label={name} onClick={close}>
          <IconCloseFill14 />
        </button>
      </div>
      <div className={styles.caption}>{name}</div>
    </div>
  )
}
