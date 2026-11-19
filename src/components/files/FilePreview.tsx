import { useEffect } from 'react'
import { IconCloseFill14 } from '../base/icons.js'
import { useFilePreview } from './filePreviewState.js'
import styles from './FilePreview.module.css'

/** 全屏图片预览：点击遮罩、关闭按钮或按 Esc 关闭。 */
export const FilePreview = () => {
  const url = useFilePreview((state) => state.url)
  const name = useFilePreview((state) => state.name)
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
      <button type="button" className={styles.close} aria-label={name} onClick={close}>
        <IconCloseFill14 />
      </button>
      <div className={styles.caption}>{name}</div>
    </div>
  )
}
