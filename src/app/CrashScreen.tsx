import { useState } from 'react'
import { Button } from '../components/base/Button.js'
import { exportToShare } from '../services/chat/backup.js'
import { translate, type TranslationKey, type TranslationParams } from '../i18n/index.js'
import styles from './CrashScreen.module.css'

/**
 * 设置存储也可能跟着坏掉，`translate` 会跟着抛错。
 * 兜底页必须能独立站起来，所以这里自带一份中文原文。
 */
const FALLBACK: Partial<Record<TranslationKey, string>> = {
  crashTitle: '界面出错了',
  crashHint: '你的对话仍然保存在本机，可以重试，或先导出再重载。',
  crashReload: '重新加载',
  crashDetails: '错误详情',
  crashExport: '导出历史对话',
  crashExportFailed: '导出失败：{message}',
  retry: '重试',
}

const text = (key: TranslationKey, params?: TranslationParams) => {
  try {
    return translate(key, params)
  } catch {
    const raw = FALLBACK[key] ?? key
    return params
      ? raw.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole))
      : raw
  }
}

/** 详情里只留前面一段，避免整屏都是调用栈 */
const DETAIL_LIMIT = 2000

export const CrashScreen = ({
  error,
  componentStack,
  onReset,
}: {
  error: Error
  componentStack: string
  onReset: () => void
}) => {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const detail = `${error.name}: ${error.message}\n\n${componentStack || error.stack || ''}`.slice(
    0,
    DETAIL_LIMIT
  )

  const onExport = async () => {
    setBusy(true)
    setFailure(null)
    const result = await exportToShare()
    // 取消分享不是失败，静默回到原样即可
    if (result && !('canceled' in result)) {
      setFailure('message' in result ? result.message : text(result.key))
    }
    setBusy(false)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card} role="alert">
        <h1 className={styles.title}>{text('crashTitle')}</h1>
        <p className={styles.hint}>{text('crashHint')}</p>
        <div className={styles.actions}>
          <Button variant="primary" size="m" onClick={onReset}>
            {text('retry')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              window.location.reload()
            }}
          >
            {text('crashReload')}
          </Button>
          <Button variant="outlined" size="m" disabled={busy} onClick={() => void onExport()}>
            {text('crashExport')}
          </Button>
        </div>
        {failure ? (
          <p className={styles.failure}>{text('crashExportFailed', { message: failure })}</p>
        ) : null}
        <details className={styles.details}>
          <summary className={styles.summary}>{text('crashDetails')}</summary>
          {/* 可长按选中复制；不自动复制，避免把隐私塞进剪贴板 */}
          <pre className={styles.pre}>{detail}</pre>
        </details>
      </div>
    </div>
  )
}
