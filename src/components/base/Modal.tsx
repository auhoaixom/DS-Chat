import clsx from 'clsx'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { Button } from './Button.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './Modal.module.css'

/** 弹窗内部的自定义关闭按钮要走的入口；在弹窗外调用得到 null */
const ModalCloseContext = createContext<(() => void) | null>(null)

/**
 * 弹窗内部的"关闭 / 取消"按钮用它，才能和 ✕、点遮罩一样播完淡出再卸载。
 * 直接调父级的 onClose 会秒退，看起来像动画漏了一处。
 */
const useModalClose = (): (() => void) | null => useContext(ModalCloseContext)

/** 弹窗里的关闭按钮：自动走淡出入口，其余样式与 Button 一致 */
export const ModalCloseButton = (props: ComponentProps<typeof Button>) => {
  const close = useModalClose()
  return <Button {...props} onClick={close ?? props.onClick} />
}

/** 当前打开的弹窗，后打开的在末尾；叠放时 Esc 只关闭最上层 */
const openModals: object[] = []

/** 关闭动画时长，与 Modal.module.css 里的 0.18s 对应 */
const EXIT_MS = 180

/** 遮罩 + 居中卡片，Esc / 点遮罩关闭 */
export const Modal = ({
  title,
  leading,
  children,
  footer,
  closable = false,
  className,
  mainClassName,
  headerClassName,
  onClose,
}: {
  title: ReactNode
  /** 标题左边的入口（如返回上一级）；不传时标题栏与以前完全一致 */
  leading?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** 标题栏右侧显示关闭按钮 */
  closable?: boolean
  className?: string
  /** 内容区的 class */
  mainClassName?: string
  /** 标题栏的 class：需要统一标题栏高度时用，不传则保持默认 */
  headerClassName?: string
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
        <ModalCloseContext.Provider value={requestClose}>
          <div className={clsx(styles.header, headerClassName)}>
            {leading ? <div className={styles.leading}>{leading}</div> : null}
            <div id={titleId} className={clsx(styles.title, leading && styles.withLeading)}>
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
        </ModalCloseContext.Provider>
      </div>
    </div>,
    document.body
  )
}
