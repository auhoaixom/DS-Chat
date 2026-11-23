import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  buildDiagnosticsReport,
  composeDetail,
  composeReport,
} from '../../services/chat/diagnosticsReport.js'
import { useChatStore } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { Modal, ModalCloseButton } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Diagnostics.module.css'

/**
 * 诊断信息弹窗：默认只给「每项一行结论」，完整记录折在下面的「详细」里。
 * 只读当前对话的快照，不改任何状态；复制永远是结论 + 明细全文，与是否展开无关。
 */
export const Diagnostics = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    state.activeId === null ? undefined : state.sessionCache[state.activeId]
  )
  const [copied, setCopied] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const report = useMemo(() => (session ? buildDiagnosticsReport(session, t) : null), [session, t])
  const full = report ? composeReport(report) : ''

  return (
    <Modal
      title={t('diagnosticsTitle')}
      closable
      onClose={onClose}
      mainClassName={styles.main}
      footer={
        <>
          <ModalCloseButton variant="outlined" size="m">
            {t('close')}
          </ModalCloseButton>
          <Button
            variant="primary"
            size="m"
            disabled={!full}
            onClick={async () => {
              if (!(await copyText(full))) {
                showToast({ key: 'copyFailed' })
                return
              }
              setCopied(true)
              showToast({ key: 'copied' })
            }}
          >
            {copied ? t('diagnosticsCopied') : t('copy')}
          </Button>
        </>
      }
    >
      {report ? (
        <>
          <pre className={styles.report}>{report.brief.join('\n')}</pre>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen(!detailOpen)}
          >
            <span>{t(detailOpen ? 'diagnosticsDetailHide' : 'diagnosticsDetailShow')}</span>
            <span className={clsx(styles.chevron, detailOpen && styles.chevronOpen)}>
              <IconChevronDownOutline14 />
            </span>
          </button>
          {detailOpen ? (
            <pre className={clsx(styles.report, styles.scroll)}>{composeDetail(report)}</pre>
          ) : null}
        </>
      ) : (
        <p>{t('diagnosticsNoSession')}</p>
      )}
    </Modal>
  )
}
