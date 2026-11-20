import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  checkPhotosAccess,
  isRecentPhotosSupported,
  listRecentPhotos,
  requestPhotosAccess,
  type PhotosAccess,
  type RecentPhotoItem,
} from '../../services/recentPhotos.js'
import {
  IconCameraOutline16,
  IconImageOutline16,
  IconPaperclipOutline16,
} from '../base/icons.js'
import styles from './AttachPanel.module.css'

export type AttachSource = 'camera' | 'album' | 'file'

/**
 * 「＋」展开的附件面板：上面是最近照片，下面是三块等宽的圆角方块
 * （拍照 / 相册 / 文件）。面板占住输入框下方、原本属于键盘的位置。
 */
export const AttachPanel = memo(function AttachPanel({
  onPick,
  onPickPhoto,
}: {
  onPick: (source: AttachSource) => void
  onPickPhoto: (photo: RecentPhotoItem) => void
}) {
  const t = useTranslate()
  // null 表示还在检查权限
  const [access, setAccess] = useState<PhotosAccess | null>(null)
  const [photos, setPhotos] = useState<RecentPhotoItem[]>([])

  const loadPhotos = useCallback(async () => {
    const items = await listRecentPhotos()
    setPhotos(items)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      if (!isRecentPhotosSupported()) {
        setAccess('unsupported')
        return
      }
      const state = await checkPhotosAccess()
      if (!active) {
        return
      }
      setAccess(state)
      if (state === 'full' || state === 'limited') {
        const items = await listRecentPhotos()
        if (active) {
          setPhotos(items)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const grant = useCallback(async () => {
    const state = await requestPhotosAccess()
    setAccess(state)
    if (state === 'full' || state === 'limited') {
      await loadPhotos()
    }
  }, [loadPhotos])

  return (
    // data-attach-scope：点击这块区域以外的地方要收起面板（见 ChatInput 里的监听）
    <div className={styles.wrap} data-attach-scope>
      {photos.length > 0 ? (
        <div className={styles.photos}>
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className={styles.photo}
              aria-label={photo.name}
              onClick={() => onPickPhoto(photo)}
            >
              <img src={photo.url} alt={photo.name} />
            </button>
          ))}
        </div>
      ) : access === 'none' ? (
        <div className={styles.grant}>
          <span className={styles.grantText}>{t('recentPhotosHint')}</span>
          <button type="button" className={styles.grantButton} onClick={() => void grant()}>
            {t('recentPhotosGrant')}
          </button>
        </div>
      ) : null}
      <div className={styles.grid}>
        <button type="button" className={styles.tile} onClick={() => onPick('camera')}>
          <span className={styles.icon}>
            <IconCameraOutline16 />
          </span>
          <span className={styles.label}>{t('attachCamera')}</span>
        </button>
        <button type="button" className={styles.tile} onClick={() => onPick('album')}>
          <span className={styles.icon}>
            <IconImageOutline16 />
          </span>
          <span className={styles.label}>{t('attachAlbum')}</span>
        </button>
        <button type="button" className={styles.tile} onClick={() => onPick('file')}>
          <span className={styles.icon}>
            <IconPaperclipOutline16 />
          </span>
          <span className={styles.label}>{t('attachFile')}</span>
        </button>
      </div>
    </div>
  )
})
