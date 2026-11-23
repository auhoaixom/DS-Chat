import clsx from 'clsx'
import { useState, type ReactNode } from 'react'

import styles from './SettingGroup.module.css'

/**
 * 设置里的折叠分组。
 *
 * 设置项变多以后平铺会让人找不到东西，所以按主题收起来：默认收起，点标题展开。
 * 动画走 `grid-template-rows: 0fr → 1fr`（高度自适应，不用量像素），
 * 三角随状态旋转；`prefers-reduced-motion` 下不播。
 */
export const SettingGroup = ({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.title}>{title}</span>
        <span className={clsx(styles.chevron, open && styles.chevronOpen)} aria-hidden>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3.5 5.25 7 8.75l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div className={clsx(styles.body, open && styles.bodyOpen)}>
        <div className={styles.inner}>{children}</div>
      </div>
    </div>
  )
}
