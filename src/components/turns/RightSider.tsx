import clsx from 'clsx'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { bindRightSiderNodes, closeRightSider, measureRightSider } from './rightSiderState.js'
import { useTurnNav } from './turnNavState.js'
import type { TurnRow } from './turnRows.js'
import styles from './RightSider.module.css'

/**
 * 右侧「对话目录」：当前这段对话里每一轮提问的列表，只负责定位。
 *
 * 三件事它都不做：不分页（窗口永远只有 MessageList 那一份）、不记选中、不长按出菜单。
 * 点一行 = 收起 + 滚到那一轮；顶部那颗「展开更早的 N 轮」就是消息界面那颗按钮。
 */
export const RightSider = () => {
  const t = useTranslate()
  const drawerRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useTurnNav((state) => state.rows)
  const older = useTurnNav((state) => state.older)
  const expandable = useTurnNav((state) => state.expandable)
  const compactedAbove = useTurnNav((state) => state.compactedAbove)
  const activeTurnId = useTurnNav((state) => state.activeTurnId)
  const expandOlder = useTurnNav((state) => state.expandOlder)
  const jumpToTurn = useTurnNav((state) => state.jumpToTurn)

  useLayoutEffect(() => {
    bindRightSiderNodes(drawerRef.current, maskRef.current)
    const onResize = () => measureRightSider()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      bindRightSiderNodes(null, null)
    }
  }, [])

  /**
   * 点「展开更早」：新行插在列表**顶上**，正在看的那一段会被整体推下去。
   * 补回高度差，让它停在原处——和消息界面补载时按住锚点是同一件事，只是这里按住的是列表。
   */
  const onExpand = useCallback(() => {
    const list = listRef.current
    const beforeHeight = list?.scrollHeight ?? 0
    const beforeTop = list?.scrollTop ?? 0
    expandOlder()
    // 渲染落定后再补：一次 rAF 可能还赶在提交之前
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!list) {
          return
        }
        const grown = list.scrollHeight - beforeHeight
        if (grown > 0) {
          list.scrollTop = beforeTop + grown
        }
      })
    })
  }, [expandOlder])

  const labelOf = (row: TurnRow) => {
    if (row.kind === 'text') {
      return row.text
    }
    if (row.kind === 'image') {
      return t('turnNavImageOnly')
    }
    if (row.kind === 'file') {
      return t('turnNavFileOnly')
    }
    // 既没正文也没附件：只可能是脏数据，给一个不占位的省略号
    return '…'
  }

  return (
    <>
      <div ref={maskRef} className={styles.mask} onClick={closeRightSider} />
      <div ref={drawerRef} className={styles.drawer}>
        <div className={styles.panel}>
          <div className={styles.top}>
            <span className={styles.heading}>{t('turnNavTitle')}</span>
            <IconButton
              size="m"
              icon={
                <span className={styles.flip}>
                  <IconPanelLeftOutline16 />
                </span>
              }
              tooltip={t('close')}
              tooltipPlacement="bottom"
              onClick={closeRightSider}
            />
          </div>
          <div ref={listRef} className={styles.list}>
            {/*
              展开到头、上面又确实压着一段摘要时，说清楚为什么目录到这儿就没了。
              覆盖段被判无效（数出来是 0）时不显示——那时摘要不生效，说这句就是骗人。
            */}
            {compactedAbove ? <div className={styles.hint}>{t('turnNavCompactedHint')}</div> : null}
            {expandable ? (
              <button type="button" className={styles.older} onClick={onExpand}>
                {t('loadOlderMore', { count: older.revealed })}
                {t('loadOlderRemaining', { remaining: older.remaining })}
              </button>
            ) : null}
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={clsx(styles.row, row.id === activeTurnId && styles.active)}
                aria-current={row.id === activeTurnId ? 'true' : undefined}
                onClick={() => jumpToTurn(row.id)}
              >
                <span className={styles.text}>{labelOf(row)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
