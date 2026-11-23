import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './Modal.module.css'

/** 当前打开的弹窗，后打开的在末尾；叠放时 Esc 只关闭最上层 */
const openModals: object[] = []

/** 关闭动画时长，与 Modal.module.css 里的 0.18s 对应 */
const EXIT_MS = 180

/** 遮罩 + 居中卡片，Esc / 点遮罩关闭 */
export const Modal = ({
  title,
  children,
  footer,
  closable = false,
  className,
  mainClassName,
  onClose,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** 标题栏右侧显示关闭按钮 */
  closable?: boolean
  className?: string
  /** 内容区的 class */
  mainClassName?: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const timersRef = useRef<number[]>([])

  /**
   * 关闭前先播一段淡出，和打开时的淡入对称。
   *
   * 播放期间挡住重复触发；父级如果拒绝关闭（比如正在删除历史、busy 中），
   * 收起状态会自己恢复，弹窗不会停在"看不见但还在"的尴尬状态。
   */
  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onCloseRef.current()
      return
    }
    closingRef.current = true
    setClosing(true)
    timersRef.current.push(
      window.setTimeout(() => {
        onCloseRef.current()
        // 父级没卸载它，说明这次关闭被拒了，恢复可见
        timersRef.current.push(
          window.setTimeout(() => {
            closingRef.current = false
            setClosing(false)
          }, 40)
        )
      }, EXIT_MS)
    )
  }, [])

  useEffect(() => {
    const token = {}
    openModals.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModals.at(-1) === token) {
        requestClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openModals.splice(openModals.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
      for (const timer of timersRef.current) {
        window.clearTimeout(timer)
      }
      timersRef.current = []
    }
  }, [requestClose])

  return createPortal(
    <div
      className={clsx(styles.overlay, closing && styles.overlayClosing)}
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className={clsx(styles.content, closing && styles.contentClosing, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <div id={titleId} className={styles.title}>
            {title}
          </div>
          {closable ? (
            <IconButton
              className={styles.close}
              tone="primary"
              icon={<IconCloseOutline16 />}
              aria-label={t('close')}
              onClick={requestClose}
            />
          ) : null}
        </div>
        {children ? <div className={clsx(styles.main, mainClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
