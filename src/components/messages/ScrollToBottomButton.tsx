import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { useFarFromBottom } from './bottomJumpState.js'
import { useChatScroll } from './scrollContext.js'
import styles from './ScrollToBottomButton.module.css'

/**
 * 一键回到底部。
 *
 * 只在「用户此刻看到的不是最后一屏」时出现——那个判断在 MessageList 的 scroll 回调里做，
 * 这里只读结论。点一下由列表带一小段动画滑到底，并恢复贴底跟随。
 *
 * 一直是同一个 DOM 节点，显隐靠 `data-visible` 切样式：隐藏时不参与命中测试、
 * 不进 Tab 顺序、读屏也念不到，但不会因为来回挂载卸载把过渡动画打断。
 */
export const ScrollToBottomButton = () => {
  const t = useTranslate()
  const far = useFarFromBottom((state) => state.far)
  const { jumpToBottom } = useChatScroll()
  return (
    <button
      type="button"
      className={styles.button}
      data-visible={far ? 'true' : 'false'}
      aria-label={t('scrollToBottom')}
      aria-hidden={!far}
      tabIndex={far ? 0 : -1}
      onClick={jumpToBottom}
    >
      <IconChevronDownOutline14 />
    </button>
  )
}
