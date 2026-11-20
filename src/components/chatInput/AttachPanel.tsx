import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCameraOutline16,
  IconImageOutline16,
  IconPaperclipOutline16,
} from '../base/icons.js'
import styles from './AttachPanel.module.css'

export type AttachSource = 'camera' | 'album' | 'file'

/**
 * 「＋」展开的附件面板：三块等宽的圆角方块（拍照 / 相册 / 文件），
 * 占住输入框下方、原本属于键盘的位置；点面板以外的地方收起。
 */
export const AttachPanel = memo(function AttachPanel({
  onPick,
}: {
  onPick: (source: AttachSource) => void
}) {
  const t = useTranslate()
  return (
    // data-attach-scope：点击这块区域以外的地方要收起面板（见 ChatInput 里的监听）
    <div className={styles.wrap} data-attach-scope>
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
