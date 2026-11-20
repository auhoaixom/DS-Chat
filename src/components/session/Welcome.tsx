import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useAttachPanelOpen } from '../chatInput/attachPanelState.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 附件面板展开时占住底部，免责声明让位
  const attachPanelOpen = useAttachPanelOpen()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        {isMobile && !attachPanelOpen ? (
          <div className={styles.caveat}>{t('contentCaveat')}</div>
        ) : null}
      </div>
    </div>
  )
}
