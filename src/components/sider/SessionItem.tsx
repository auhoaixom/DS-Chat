import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconPinOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession, setSessionPinned } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

/** 长按多久弹出菜单；和系统「长按」的手感一致 */
const LONG_PRESS_MS = 450
/** 手指移动超过这个距离就当成滚动，不算长按 */
const PRESS_SLOP = 10
/** 长按弹出后这段时间内的 click 都要忽略（同一次手势会补发 click） */
const IGNORE_CLICK_MS = 400

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const displayTitle = session.title || t('untitledChat')
  const timerRef = useRef<number | undefined>(undefined)
  const originRef = useRef({ x: 0, y: 0 })
  /** 长按弹出菜单的时刻：之后这一串 click 都要忽略，否则松手那一下会把菜单关掉 */
  const openedAtRef = useRef(0)

  const cancelPress = () => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  useEffect(() => cancelPress, [])

  /** 按住不动到点就弹菜单；touch 与 pointer 两条路都走这里 */
  const startPress = (x: number, y: number) => {
    if (menuOpen || timerRef.current !== undefined) {
      return
    }
    originRef.current = { x, y }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      openedAtRef.current = performance.now()
      setMenuOpen(true)
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
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
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
          onSelect: onDelete,
        },
      ]}
    >
      {({ open, toggle }) => (
        <div
          className={clsx(styles.item, active && styles.active)}
          // 触屏走长按；桌面鼠标用右键，长按也兼容
          onContextMenu={(event) => {
            event.preventDefault()
            toggle()
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
            // 既不能切会话，也不能走到下面的「收起菜单」把刚弹出的菜单关掉
            if (performance.now() - openedAtRef.current < IGNORE_CLICK_MS) {
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
