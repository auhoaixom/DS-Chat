import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { hideToast, useToast } from './toastState.js'
import styles from './Toast.module.css'

export const Toast = () => {
  const t = useTranslate()
  const { id, message, action } = useToast()
  if (!message) {
    return null
  }
  const actionButton = action ? (
    <button
      type="button"
      className={styles.action}
      onClick={() => {
        action.onClick()
        hideToast()
      }}
    >
      {t(action.key)}
    </button>
  ) : null
  if (typeof message === 'string') {
    return (
      <div key={id} className={styles.toast} role="status">
        {message}
        {actionButton}
      </div>
    )
  }
  const error = message.type === 'error'
  return (
    <div key={id} className={clsx(styles.toast, error && styles.error)} role="status">
      {error ? (
        <span className={styles.icon}>
          <IconToastError16 />
        </span>
      ) : null}
      <span className={styles.content}>
        {t(message.key, message.params)}
        {message.link ? (
          <a className={styles.link} href={message.link.href} target="_blank" rel="noreferrer">
            {t(message.link.key)}
          </a>
        ) : null}
      </span>
      {actionButton}
    </div>
  )
}
