import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭。传 open 也可由外部驱动（长按弹菜单） */
export const Menu = ({
  options,
  children,
  anchorClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
  /** 触发元素外层锚点的 class，用来让锚点撑满整行（长按整行弹菜单时用） */
  anchorClassName?: string
  /** 受控模式的开合状态；不传则内部自己管 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) => {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setInnerOpen(next)
    }
    onOpenChange?.(next)
  }
  const close = () => setOpen(false)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  // 右对齐：菜单贴住这一行（也就是抽屉）的右侧，不压住下方会话的名称
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'end', offset: 4 }
  )
  // 外部那一下点击只用来关菜单，不再触发下面的会话行
  useDismiss(open, [anchorRef, floatingRef], close, { swallowOutsideClick: true })

  return (
    <>
      <span ref={anchorRef} className={clsx(styles.anchor, anchorClassName)}>
        {children({ open, toggle: () => setOpen(!open) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
            >
              {options.map((option) => (
                <div
                  key={option.key}
                  role="menuitem"
                  className={clsx(styles.option, option.danger && styles.danger)}
                  onClick={() => {
                    setOpen(false)
                    option.onSelect()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
