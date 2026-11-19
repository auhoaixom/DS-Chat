import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import styles from './ActionSheet.module.css'

export type ActionSheetItem = {
  key: string
  label: string
  icon?: ReactNode
}

/**
 * 从底部升起的选项面板：每项都是整行可点的按钮，点遮罩或取消关闭。
 * 用于替代系统 AlertDialog，让选择栏跟随应用主题。
 */
export const ActionSheet = ({
  open,
  title,
  items,
  onSelect,
  onClose,
}: {
  open: boolean
  title?: string
  items: ActionSheetItem[]
  onSelect: (key: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
        {title ? <div className={styles.title}>{title}</div> : null}
        <div className={styles.list}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={styles.item}
              onClick={() => onSelect(item.key)}
            >
              {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
              <span className={styles.label}>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className={styles.cancel} onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </div>,
    document.body
  )
}
