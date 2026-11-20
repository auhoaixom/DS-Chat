import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useAttachPanelOpen } from '../chatInput/attachPanelState.js'
import { MessageList } from '../messages/MessageList.js'
import { ContextMeter } from './ContextMeter.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 附件面板展开时占住底部，免责声明让位
  const attachPanelOpen = useAttachPanelOpen()
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title}>
          <ContextMeter session={session} />
        </MobileHeader>
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerRight}>
            <ContextMeter session={session} />
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            {attachPanelOpen ? null : (
              <div className={styles.caveat}>{t('contentCaveat')}</div>
            )}
          </div>
        }
      />
    </div>
  )
}
