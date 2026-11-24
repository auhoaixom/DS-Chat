import { useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { fetchModels } from '../../services/api/client.js'
import { setModel, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/**
 * 模型调用名。和 API Key 一样由用户填、由服务端 `/models` 校验后才保存——
 * 名字填错会变成"每条消息都发不出去"，所以必须在保存那一刻挡住。
 */
export const ModelField = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState<string[]>([])

  const beginEdit = () => {
    setValue(model)
    setError(null)
    setChecking(false)
    setEditing(true)
    // 顺手把可用的名字列出来，省得用户去别处查
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      return
    }
    void fetchModels(apiKey)
      .then((models) => setAvailable(models.map((item) => item.id)))
      .catch(() => setAvailable([]))
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
  }

  const submit = async () => {
    const next = value.trim()
    if (checking) {
      return
    }
    if (!next) {
      setError(t('modelEmpty'))
      return
    }
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      setError(t('modelNeedsKey'))
      return
    }
    setChecking(true)
    setError(null)
    try {
      const models = await fetchModels(apiKey)
      const ids = models.map((item) => item.id)
      setAvailable(ids)
      if (!ids.includes(next)) {
        setError(t('modelNotFound'))
        return
      }
      setModel(next)
      setEditing(false)
    } catch {
      setError(t('modelCheckFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('settingsModel')}</div>
      {editing ? (
        <>
          <div className={styles.apiKeyInput}>
            <input
              type="text"
              placeholder={t('modelPlaceholder')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void submit()
                }
              }}
            />
          </div>
          <div className={styles.modelActions}>
            <button
              type="button"
              className={styles.modelConfirm}
              disabled={checking}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void submit()}
            >
              {checking ? t('modelChecking') : t('confirm')}
            </button>
            <button type="button" className={styles.modelCancel} onClick={cancel}>
              {t('cancel')}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.apiKeySaved}>
          {/* 模型名是用户要拿去别处用的，唯一允许选中的设置值 */}
          <span className={styles.modelValue} data-selectable>
            {model}
          </span>
          <IconButton
            tone="primary"
            icon={<IconEditOutline16 />}
            tooltip={t('settingsModelEdit')}
            onClick={beginEdit}
          />
        </div>
      )}
      {error ? <div className={styles.error}>{error}</div> : null}
      {editing && available.length > 0 ? (
        <div className={styles.modelAvailable}>
          {t('modelAvailable', { list: available.join(' / ') })}
        </div>
      ) : null}
    </div>
  )
}
