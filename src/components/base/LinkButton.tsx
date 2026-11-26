import clsx from 'clsx'
import type { AnchorHTMLAttributes } from 'react'
import styles from './Button.module.css'

/**
 * 长得跟 `Button` 完全一样，但渲染成 `<a>`。
 *
 * 跳外链必须是链接：原生容器里 `<a target="_blank">` 会被交给系统浏览器打开，
 * 而 `window.open` 在没有开多窗口支持的 WebView 里不可靠。语义上也该是链接——
 * 读屏会念"链接"、长按能拿到地址、系统知道这是往外走。
 *
 * 样式直接借用 `Button.module.css`：同一个 CSS Module 被两个组件引用，
 * 类名哈希一致，外观天然同步，不必复制一份按钮样式。
 */
export const LinkButton = ({
  variant = 'outlined',
  size = 'm',
  block = false,
  className,
  href,
  ...props
}: {
  /** 链接不承担危险操作，所以没有 danger 那两种 */
  variant?: 'primary' | 'outlined'
  size?: 'l' | 'm' | 's'
  block?: boolean
  href: string
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className={clsx(styles.button, styles[variant], styles[size], block && styles.block, className)}
    {...props}
  />
)
