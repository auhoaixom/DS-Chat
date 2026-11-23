import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { confirmEncryption } from '../../services/boot.js'
import { exportToShare } from '../../services/chat/backup.js'
import { useEncMigration } from '../../services/crypto/migration.js'
import { Button } from '../base/Button.js'
import { nextBackupState, type BackupState } from './backupOutcome.js'
import styles from './EncryptionGate.module.css'

/**
 * 本地数据加密的引导层。
 *
 * 只在「库里已有明文会话」时出现：先说清楚要发生什么、这一版装回去就读不了了，
 * 让用户有机会导一次备份，再动数据。
 *
 * 刻意做成不可关闭、不可跳过：迁移和用户操作并发是这里唯一真正会写坏数据的情形。
 * 遮罩同时挡住了底下的界面，所以启动顺序（取密钥 → 加密 → 解锁 Key → 读列表）
 * 不需要在每个入口再补一遍「准备好了没」的判断。
 */
export const EncryptionGate = () => {
  const t = useTranslate()
  const { phase, done, total, error } = useEncMigration()
  const [backup, setBackup] = useState<BackupState>('idle')

  if (phase === 'idle' || phase === 'done') {
    return null
  }

  const onBackup = async () => {
    setBackup('busy')
    // 取消分享会回到 idle，绝不显示「备份已生成」——那份文件其实没被交出去
    setBackup(nextBackupState(await exportToShare()))
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.title}>
          {phase === 'failed' ? t('encryptionFailedTitle') : t('encryptionNoticeTitle')}
        </div>

        {phase === 'notice' ? (
          <>
            <div className={styles.body}>{t('encryptionNoticeBody')}</div>
            <div className={styles.hint}>{t('encryptionNoticeBackupHint')}</div>
            {backup === 'done' ? (
              <div className={styles.done}>{t('encryptionNoticeBackupDone')}</div>
            ) : null}
            {backup === 'error' ? (
              <div className={styles.error}>{t('encryptionNoticeBackupFailed')}</div>
            ) : null}
            <div className={styles.footer}>
              <Button
                variant="outlined"
                size="m"
                disabled={backup === 'busy'}
                onClick={() => void onBackup()}
              >
                {t('encryptionNoticeBackup')}
              </Button>
              <Button variant="primary" size="m" onClick={() => void confirmEncryption()}>
                {t('encryptionNoticeProceed')}
              </Button>
            </div>
          </>
        ) : null}

        {phase === 'running' ? (
          <>
            <div className={styles.body}>{t('encryptionRunning')}</div>
            <div className={styles.track}>
              <div className={styles.bar} style={{ width: `${percent}%` }} />
            </div>
            <div className={styles.count}>
              {total > 0 ? `${done} / ${total}` : `0 / ${total}`}
            </div>
          </>
        ) : null}

        {phase === 'failed' ? (
          <>
            <div className={styles.body}>{error ?? t('encryptionFailedBody')}</div>
            <div className={styles.footer}>
              <Button variant="primary" size="m" onClick={() => void confirmEncryption()}>
                {t('retry')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
