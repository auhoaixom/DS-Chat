import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconPinOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession, setSessionPinned } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { useDismiss } from '../base/anchored.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import { createPressMenu } from './pressMenu.js'
import styles from './SessionItem.module.css'

/** 长按多久弹出菜单；和系统「长按」的手感一致 */
const LONG_PRESS_MS = 450
/** 手指移动超过这个距离就当成滚动，不算长按 */
const PRESS_SLOP = 10

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: (session: SessionSummary) => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const displayTitle = session.title || t('untitledChat')
  const timerRef = useRef<number | undefined>(undefined)
  const originRef = useRef({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * 同一次长按会被 WebView 送好几遍（计时器 / contextmenu / 松手后的 click），
   * 顺序各机型不同。这个账本只认一次按下，不认时间窗口 —— 见 pressMenu.ts。
   */
  const press = useRef(createPressMenu())

  const cancelPress = () => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  useEffect(() => cancelPress, [])

  /** 这次手势弹出菜单：标记后面补发的 click 要吞掉 */
  const openFromPress = () => {
    press.current.opened()
    setMenuOpen(true)
  }

  /** 改名落盘：空标题或没改就当作放弃 */
  const commitRename = (title: string) => {
    setEditing(false)
    const next = title.trim()
    if (next && next !== displayTitle) {
      renameSession(session.id, next)
    }
  }

  // 点输入框外面 = 保存并退出（读当前输入框里的值），而且那一下点击不会穿透到下面的会话行
  useDismiss(editing, [inputRef], () => commitRename(inputRef.current?.value ?? displayTitle), {
    swallowOutsideClick: true,
  })

  /** 按住不动到点就弹菜单；touch 与 pointer 两条路都走这里 */
  const startPress = (x: number, y: number) => {
    // 每一次按下都是一次新手势：上一次手势遗留的「待吞 click」在这里作废。
    // 必须放在下面那个 early return **之前** —— 菜单已经开着时再点这一行不会开菜单，
    // 但那一下点击是真的点击（用来收起菜单），不能被上一次长按的标记吞掉。
    press.current.pressStart()
    if (menuOpen || timerRef.current !== undefined) {
      return
    }
    originRef.current = { x, y }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      openFromPress()
    }, LONG_PRESS_MS)
  }

  const movePress = (x: number, y: number) => {
    if (timerRef.current === undefined) {
      return
    }
    if (
      Math.abs(x - originRef.current.x) > PRESS_SLOP ||
      Math.abs(y - originRef.current.y) > PRESS_SLOP
    ) {
      cancelPress()
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        // 失焦（包括点到别处）= 保存
        onBlur={(event) => commitRename(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            commitRename(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            // 只有 Esc 是放弃
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <Menu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      anchorClassName={styles.menuAnchor}
      options={[
        {
          key: 'pin',
          label: t(session.pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
          icon: <IconPinOutline16 />,
          onSelect: () => setSessionPinned(session.id, !session.pinned),
        },
        {
          key: 'rename',
          label: t('sessionItemMenuRenameOption'),
          icon: <IconEditOutline16 />,
          onSelect: () => setEditing(true),
        },
        {
          key: 'delete',
          label: t('delete'),
          icon: <IconTrashOutline16 />,
          danger: true,
          onSelect: () => onDelete(session),
        },
      ]}
    >
      {({ open, toggle }) => (
        <div
          className={clsx(styles.item, active && styles.active, menuOpen && styles.pressed)}
          // 触屏走长按；桌面鼠标用右键，长按也兼容。
          // 这里**只开不关**：系统这份 contextmenu 和我们的计时器是同一次手势，
          // 用 toggle 的话谁晚到谁就把菜单关掉（华为上 450ms 计时器先到，菜单当场消失）
          onContextMenu={(event) => {
            event.preventDefault()
            openFromPress()
          }}
          onTouchStart={(event) => {
            cancelPress()
            const touch = event.touches.length === 1 ? event.touches[0] : undefined
            if (touch) {
              startPress(touch.clientX, touch.clientY)
            }
          }}
          onTouchMove={(event) => {
            const touch = event.touches[0]
            if (touch) {
              movePress(touch.clientX, touch.clientY)
            }
          }}
          onTouchEnd={cancelPress}
          onTouchCancel={cancelPress}
          // pointer 覆盖鼠标与不派发 touch 的 WebView；和上面的 touch 互不干扰（有 timer 就去重）
          onPointerDown={(event) => {
            if (event.button === 0) {
              cancelPress()
              startPress(event.clientX, event.clientY)
            }
          }}
          onPointerMove={(event) => movePress(event.clientX, event.clientY)}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onClick={() => {
            // 长按弹出菜单后，这一次手势跟着来的 click 一律忽略：
            // 既不能切会话，也不能走到下面的「收起菜单」把刚弹出的菜单关掉。
            // 按手势认、不按时间认：手指在菜单弹出后按多久都不影响（按时间认的版本
            // 在华为上只要按超过 400ms，松手就把菜单关了）
            if (press.current.takeClick()) {
              return
            }
            // 菜单开着时点这一行是收起菜单，不是切换会话
            if (open) {
              toggle()
              return
            }
            selectSession(session.id)
            closeMobileSider()
          }}
        >
          <div className={styles.title}>{displayTitle}</div>
        </div>
      )}
    </Menu>
  )
})
