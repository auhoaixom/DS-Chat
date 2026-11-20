import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { estimatePromptTokens, planCompaction } from '../../services/chat/compaction.js'
import { cancelCompaction, compactSession, useChatStore } from '../../services/chat/store.js'
import { formatTokens, getContextWindow } from '../../services/chat/tokens.js'
import type { Session } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { closeCompactionDialog, useCompactionDialog } from './compactionState.js'
import styles from './CompactionDialog.module.css'

/** 手动压缩的确认与进度弹窗；由会话页渲染，打开状态存在 compactionState */
export const CompactionDialog = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const opened = useCompactionDialog((state) => state.sessionId === session.id)
  const [busy, setBusy] = useState(false)
  const run = useChatStore((state) => state.compacting[session.id])
  const plan = useMemo(
    () => planCompaction(getVisibleMessages(session), getContextWindow(), { manual: true }),
    [session]
  )
  if (!opened) {
    return null
  }

  const before = estimatePromptTokens(session)
  const after = plan
    ? Math.max(0, before - plan.coveredTokens + 1_200)
    : before

  const start = async () => {
    setBusy(true)
    const result = await compactSession(session.id)
    setBusy(false)
    if (result === 'done') {
      closeCompactionDialog()
      showToast({ key: 'compactionDone' })
    } else if (result === 'busy') {
      showToast({ key: 'compactionBusy' })
    } else if (result === 'skipped') {
      showToast({ key: 'compactionNoNeed' })
    } else {
      showToast({ key: 'compactionFailed' })
    }
  }

  return (
    <Modal
      title={t('compactionTitle')}
      closable={!busy}
      className={styles.dialog}
      onClose={() => {
        if (!busy) {
          closeCompactionDialog()
        }
      }}
      footer={
        run || busy ? (
          <Button variant="outlined" size="m" onClick={() => cancelCompaction(session.id)}>
            {t('compactionStop')}
          </Button>
        ) : (
          <>
            <Button variant="outlined" size="m" onClick={closeCompactionDialog}>
              {t('cancel')}
            </Button>
            {plan ? (
              <Button variant="primary" size="m" onClick={() => void start()}>
                {t('compactionStart')}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {run ? (
        <div className={styles.progress} role="status" aria-live="polite">
          <div className={styles.progressText}>
            {run.phase === 'chunk'
              ? t('compactionChunkProgress', { done: run.done + 1, total: run.total })
              : t('compactionRunning')}
          </div>
          <div className={styles.progressMeta}>
            {t('compactionProgressChars', { count: run.chars })}
          </div>
        </div>
      ) : plan ? (
        <div className={styles.body}>
          <p className={styles.paragraph}>
            {t('compactionDescription', {
              count: plan.coveredIds.length,
              keep: plan.keptCount,
            })}
          </p>
          <p className={styles.paragraph}>
            {t('compactionEstimate', {
              before: formatTokens(before),
              after: formatTokens(after),
            })}
          </p>
          <p className={styles.hint}>{t('compactionKeepsOriginals')}</p>
        </div>
      ) : (
        <div className={styles.body}>
          <p className={styles.paragraph}>{t('compactionNoNeed')}</p>
        </div>
      )}
    </Modal>
  )
}
