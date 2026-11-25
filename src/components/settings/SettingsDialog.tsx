import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { clearHistory, exportToShare, importHistory } from '../../services/chat/backup.js'
import { useBackupProgress } from '../../services/backupProgress.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, locationDisplayName, provinces } from '../../services/location.js'
import { locate, MAX_ACCURACY_M } from '../../services/locate.js'
import {
  isChineseBrowser,
  LOCALES,
  setEnterNewline,
  setLocale,
  setLocation,
  setShowContextMeter,
  setShowMessageCost,
  setThemePreference,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { fetchBalance, formatBalance, type BalanceAvailability } from '../../services/balance.js'
import { openSystemSettings } from '../../services/keepAlive.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal, ModalCloseButton } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { Diagnostics } from './Diagnostics.js'
import { ModelField } from './ModelField.js'
import {
  backToRoot,
  closeSettings,
  openSection,
  SETTINGS_SECTIONS,
  useSettingsDialog,
  type SettingsSection,
} from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗是两层的：先列出五个分类，点进去才是该分类的具体设置项。
 * 手机上它仍是从底部滑出的那个窗口（尺寸、圆角都不变），变的只是窗口内部。
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

/** 分类名；列表与子页标题共用同一份文案 */
const sectionTitles: Record<SettingsSection, TranslationKey> = {
  account: 'settingsSectionAccount',
  data: 'settingsSectionData',
  region: 'settingsSectionRegion',
  personalization: 'settingsSectionPersonalization',
  chat: 'settingsSectionChat',
}

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // null = 分类列表，其余 = 停在该分类的子页
  const section = useSettingsDialog((state) => state.section)
  // 换页不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(new Map<SettingsSection, HTMLButtonElement>())
  /** 上一次停留的子页：返回列表后把焦点还给那一行 */
  const lastSection = useRef<SettingsSection | null>(null)
  /** 首次挂载不播平移动画，弹窗本身已经有淡入 */
  const mounted = useRef(false)

  /**
   * 分类行下面那句状态。
   *
   * 全是本地已有的数据，不为一行摘要去发请求——所以「账户」只写模型名，
   * 余额仍然要进子页才查。状态变化时这行会跟着变，用户不点进去也知道现在是什么样。
   */
  const model = useSettings((state) => state.model)
  const sessionCount = useChatStore((state) => state.sessions.length)
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const themePreference = useSettings((state) => state.themePreference)
  const enterNewline = useSettings((state) => state.enterNewline)
  const showContextMeter = useSettings((state) => state.showContextMeter)
  const showMessageCost = useSettings((state) => state.showMessageCost)
  const hiddenDisplays = (showContextMeter ? 0 : 1) + (showMessageCost ? 0 : 1)
  const themeLabel = themeOptions.find((item) => item.value === themePreference)?.label
  const summaries: Record<SettingsSection, string> = {
    account: model,
    data: t('settingsSummarySessions', { count: sessionCount }),
    region: [
      LOCALES.find((item) => item.value === locale)?.label,
      locationDisplayName(location, locale),
    ]
      .filter(Boolean)
      .join(' · '),
    personalization: [
      themeLabel ? t(themeLabel) : '',
      hiddenDisplays > 0 ? t('settingsSummaryHidden', { count: hiddenDisplays }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    chat: t(enterNewline ? 'settingsSummaryEnterNewline' : 'settingsSummaryEnterSend'),
  }

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (section) {
      lastSection.current = section
      // 新页面刚出现，把焦点送进去，读屏才知道换页了
      contentRef.current?.focus()
      return
    }
    rowsRef.current.get(lastSection.current ?? 'account')?.focus()
  }, [section])

  return (
    <>
      <Modal
        title={section ? t(sectionTitles[section]) : t('settings')}
        leading={
          section ? (
            <IconButton
              size="xl"
              tone="primary"
              className={styles.back}
              icon={<IconChevronRightOutline14 />}
              aria-label={t('settingsBack')}
              onClick={backToRoot}
            />
          ) : undefined
        }
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        headerClassName={styles.header}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        {/* key 变化 = 换页：重播动画，顺带把滚动位置归零 */}
        <div
          ref={contentRef}
          tabIndex={-1}
          className={clsx(
            styles.content,
            mounted.current && (section ? styles.pageForward : styles.pageBack)
          )}
          key={section ?? 'root'}
        >
          {section === null ? (
            <div className={styles.sectionList}>
              {SETTINGS_SECTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={styles.sectionRow}
                  ref={(element) => {
                    if (element) {
                      rowsRef.current.set(item, element)
                    } else {
                      rowsRef.current.delete(item)
                    }
                  }}
                  onClick={() => openSection(item)}
                >
                  <span className={styles.sectionText}>
                    <span>{t(sectionTitles[item])}</span>
                    <span className={clsx(styles.description, styles.sectionSummary)}>
                      {summaries[item]}
                    </span>
                  </span>
                  <IconChevronRightOutline14 />
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.pageBody}>
              {section === 'account' ? (
                <>
                  <ApiKeyField editor={apiKeyEditor} />
                  <ModelField />
                  <BalanceSetting />
                  {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
                </>
              ) : null}
              {section === 'data' ? (
                <>
                  <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                  <ExportHistory disabled={historyBusy} />
                  {/* 诊断是给我排查用的，发行版直接不显示入口（见 rspack 的 __DIAGNOSTICS__） */}
                  {__DIAGNOSTICS__ ? (
                    <SettingCell
                      label={t('diagnostics')}
                      description={t('diagnosticsHint')}
                      status={null}
                      action={
                        <Button
                          variant="outlined"
                          size="m"
                          className={styles.cellButton}
                          onClick={() => setDiagnosticsOpen(true)}
                        >
                          {t('diagnosticsView')}
                        </Button>
                      }
                    />
                  ) : null}
                  <SettingCell
                    label={t('deleteAllSessions')}
                    status={null}
                    action={
                      <Button
                        variant="dangerOutlined"
                        size="m"
                        className={styles.cellButton}
                        disabled={historyBusy}
                        onClick={historyDelete.open}
                      >
                        {t('delete')}
                      </Button>
                    }
                  />
                </>
              ) : null}
              {section === 'region' ? (
                <>
                  <LocaleSetting />
                  <LocationSetting />
                </>
              ) : null}
              {section === 'personalization' ? (
                <>
                  <ThemeSetting />
                  <ShowContextMeterSetting />
                  <ShowMessageCostSetting />
                </>
              ) : null}
              {section === 'chat' ? (
                <>
                  <EnterKeySetting />
                  <KeepAliveSetting />
                </>
              ) : null}
            </div>
          )}
        </div>
        {/* 窗口最底下一行版本号：固定在那里，不跟内容滚 */}
        <div className={styles.version}>{`DS Chat ${__APP_VERSION__}`}</div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
      {diagnosticsOpen ? <Diagnostics onClose={() => setDiagnosticsOpen(false)} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <ModalCloseButton variant="outlined" autoFocus disabled={historyDelete.busy}>
            {t('cancel')}
          </ModalCloseButton>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  // 一整块：位置选择与「用手机定位」同属"位置信息"，块内不画分隔线
  return (
    <div className={styles.locationGroup}>
      <SettingCell
        label={t('settingsLocation')}
        description={t('settingsLocationHint')}
        status={null}
        className={styles.locationCell}
        action={
          <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                options={[
                  // 置顶的"不定位"：选中它等于整条位置清空，市级跟着回到"不定位"
                  { value: '', label: t('settingsLocationNone') },
                  ...provinces.map((item) => ({ value: item.code, label: item.name })),
                ]}
                onChange={(value) => {
                  if (value === '') {
                    setLocation(null)
                    return
                  }
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                options={[
                  { value: '', label: t('settingsLocationNone') },
                  ...(province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []),
                ]}
                onChange={(value) => {
                  if (!province) {
                    return
                  }
                  // 只改市：选"不定位"就只清市，省保持不动
                  setLocation({
                    region: 'CN',
                    province: province.code,
                    ...(value === '' ? {} : { city: value }),
                  })
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              options={[
                { value: '', label: t('settingsLocationNone') },
                ...regionCodes
                  .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                  .sort((a, b) => a.label.localeCompare(b.label, locale)),
              ]}
              onChange={(value) => setLocation(value === '' ? null : { region: value })}
            />
          )}
        </div>
      }
    />
      {isChineseBrowser() ? <LocateSetting /> : null}
    </div>
  )
}

/** 定位结果的状态机；文案在渲染时统一翻译 */
type LocateStatus =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'done'; place: string }
  | { kind: 'denied' }
  | { kind: 'failed' }
  | { kind: 'unsupported' }
  | { kind: 'imprecise'; km: number }

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  // 不吃缓存：上一次的坐标对"填当前位置"毫无意义
  maximumAge: 0,
}

const readPosition = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS)
  })

/**
 * 用手机定位自动填省市。
 *
 * 只在中文区显示（海外那套只到国家一级，没有城市数据）。精度差时重试一次，
 * 仍差就拒绝写入——坐标偏出五公里，再怎么匹配都是瞎猜。
 */
const LocateSetting = () => {
  const t = useTranslate()
  const location = useSettings((state) => state.location)
  const [status, setStatus] = useState<LocateStatus>({ kind: 'idle' })
  /** 上一次由「定位」写进去的省市；用来区分"是我们写的"还是"用户自己改的" */
  const locatedKey = useRef<string | null>(null)
  const currentKey = `${location?.province ?? ''}|${location?.city ?? ''}`

  /**
   * 用户自己在下拉里改了地点（含改回"不定位"）之后，那句「已导入：…」就该消失——
   * 它描述的是上一次定位的结果，已经和眼前的选项对不上了。
   * 只清掉成功态；失败/权限/精度那几条仍然说明最近一次尝试，留着更有用。
   */
  useEffect(() => {
    if (status.kind !== 'done' || currentKey === locatedKey.current) {
      return
    }
    locatedKey.current = null
    setStatus({ kind: 'idle' })
  }, [currentKey, status.kind])

  const locateNow = async () => {
    if (!navigator.geolocation) {
      setStatus({ kind: 'unsupported' })
      return
    }
    setStatus({ kind: 'locating' })
    try {
      let position = await readPosition()
      if (position.coords.accuracy > MAX_ACCURACY_M) {
        position = await readPosition()
      }
      const result = locate({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      })
      if (result.kind === 'imprecise') {
        setStatus({ kind: 'imprecise', km: result.km })
        return
      }
      if (result.kind === 'unmatched') {
        setStatus({ kind: 'failed' })
        return
      }
      const province = provinces.find((item) => item.code === result.province)
      const city = province?.cities.find((item) => item.code === result.city)
      locatedKey.current = `${result.province}|${result.city ?? ''}`
      setLocation({ region: 'CN', province: result.province, city: result.city ?? undefined })
      setStatus({ kind: 'done', place: [province?.name, city?.name].filter(Boolean).join(' / ') })
    } catch (error) {
      // 1 = PERMISSION_DENIED；超时与不可用都归到"失败"
      const code = (error as GeolocationPositionError | undefined)?.code
      setStatus({ kind: code === 1 ? 'denied' : 'failed' })
    }
  }

  const description = (() => {
    switch (status.kind) {
      case 'locating':
        return t('settingsLocationImporting')
      case 'done':
        return t('settingsLocationImported', { place: status.place })
      case 'denied':
        return t('settingsLocationImportDenied')
      case 'failed':
        return t('settingsLocationImportFailed')
      case 'unsupported':
        return t('settingsLocationUnsupported')
      case 'imprecise':
        return t('settingsLocationLowAccuracy', { km: status.km })
      default:
        return undefined
    }
  })()

  return (
    <SettingCell
      label={t('settingsLocationAutoHint')}
      description={description}
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={status.kind === 'locating'}
          onClick={() => void locateNow()}
        >
          {t('settingsLocationAutoAction')}
        </Button>
      }
    />
  )
}

/**
 * 「允许后台运行」：切到后台、锁屏后仍继续生成。
 *
 * 各家自建的后台开关（华为的应用启动管理、小米的省电策略、vivo 的后台高耗电…）既读不到状态、
 * 也没有能验证的跳转入口，所以这里只有两句话：说清开了有什么用，再给一句通用的指路，
 * 然后把用户送到所有安卓机都有的系统「设置」首页——具体往哪翻由他自己找。
 *
 * 不按厂商分支：我们只有两台能验证的机器，写五条路径就必然有几条是错的（vivo 那条已经验错）。
 * 不显示"已允许/未允许"：那个状态读不到，宁可不说，也不给一个假的结论。
 */
const KeepAliveSetting = () => {
  const t = useTranslate()
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <>
      <SettingCell
        label={t('settingsKeepAlive')}
        description={t('settingsKeepAliveHint')}
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            onClick={() => setGuideOpen(true)}
          >
            {t('settingsKeepAliveAction')}
          </Button>
        }
      />
      {guideOpen ? (
        <Modal
          title={t('settingsKeepAlive')}
          closable
          onClose={() => setGuideOpen(false)}
          footer={
            <>
              <ModalCloseButton variant="outlined" size="m">{t('cancel')}</ModalCloseButton>
              <Button
                variant="primary"
                size="m"
                onClick={() => {
                  setGuideOpen(false)
                  void openSystemSettings()
                }}
              >
                {t('settingsKeepAliveOpen')}
              </Button>
            </>
          }
        >
          <p className={styles.keepAliveGuide}>{t('settingsKeepAliveGuide')}</p>
        </Modal>
      ) : null}
    </>
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      description={t('settingsLocaleHint')}
      status={null}
      // 与「位置信息」同一种排法：说明文字单独占一行，选择器换到下一行，
      // 否则说明挤在窄栏里会折成「…用哪种语 / 言」这种单字余行
      className={styles.locationCell}
      action={
        <div className={styles.localeAction}>
          {/* 固定的英文提示：看不懂当前界面语言的人，靠这个词找到语言设置 */}
          <span className={styles.localeHint} aria-hidden>
            Language
          </span>
          <Select
            ariaLabel={t('settingsLocalePreference')}
            value={locale}
            options={LOCALES}
            onChange={setLocale}
          />
        </div>
      }
    />
  )
}

/** 手机回车键：默认换行，习惯直接发送的人可以切回来 */
const EnterKeySetting = () => {
  const t = useTranslate()
  const enterNewline = useSettings((state) => state.enterNewline)
  return (
    <SettingCell
      label={t('settingsEnterKey')}
      description={t(
        enterNewline ? 'settingsEnterKeyDescNewline' : 'settingsEnterKeyDescSend'
      )}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsEnterKey')}
          value={enterNewline ? 'newline' : 'send'}
          options={[
            { value: 'newline', label: t('settingsEnterNewline') },
            { value: 'send', label: t('settingsEnterSend') },
          ]}
          onChange={(value) => setEnterNewline(value === 'newline')}
        />
      }
    />
  )
}

/**
 * 「上下文用量与压缩」：顶栏那个圆环入口。
 *
 * 关掉不只是藏一个百分比——用量明细、手动压缩、撤销压缩、会话合计花费都在那个浮层里，
 * 所以它们绑定成一个开关，关了就一起没有。自动压缩不依赖这个入口，照常工作。
 */
const ShowContextMeterSetting = () => {
  const t = useTranslate()
  const showContextMeter = useSettings((state) => state.showContextMeter)
  return (
    <SettingCell
      label={t('settingsShowContextMeter')}
      description={t('settingsShowContextMeterHint')}
      status={null}
      className={styles.switchCell}
      action={
        <Switch
          checked={showContextMeter}
          ariaLabel={t('settingsShowContextMeter')}
          onChange={setShowContextMeter}
        />
      }
    />
  )
}

/** 「单条消息花费」：只藏每条回复底部那行金额，计费与会话合计都不受影响 */
const ShowMessageCostSetting = () => {
  const t = useTranslate()
  const showMessageCost = useSettings((state) => state.showMessageCost)
  return (
    <SettingCell
      label={t('settingsShowMessageCost')}
      description={t('settingsShowMessageCostHint')}
      status={null}
      className={styles.switchCell}
      action={
        <Switch
          checked={showMessageCost}
          ariaLabel={t('settingsShowMessageCost')}
          onChange={setShowMessageCost}
        />
      }
    />
  )
}

/**
 * 四种可用性状态各自的说法。
 * `invalid` 是接口给了个说不清的值——界面上保留英文 Unknown，不替它猜。
 */
const balanceDetail = (
  availability: BalanceAvailability,
  t: (key: TranslationKey) => string
): string =>
  availability === 'invalid'
    ? 'Unknown'
    : t(availability === 'available' ? 'balanceAvailable' : 'balanceUnavailable')

/** 账户余额：打开时查一次，右上角可按需刷新 */
const BalanceSetting = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [text, setText] = useState('')
  const [detail, setDetail] = useState('')
  const [hint, setHint] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    if (!apiKey) {
      setStatus('error')
      setText(t('balanceNoKey'))
      setHint('')
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setText(t('balanceLoading'))
    setDetail(t('balanceChecking'))
    const result = await fetchBalance(apiKey, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    if (result.ok) {
      const info =
        result.snapshot.infos.find((item) => item.currency === 'CNY') ?? result.snapshot.infos[0]
      setStatus('done')
      setText(info ? formatBalance(info) : '—')
      setDetail(balanceDetail(result.snapshot.availability, t))
      setHint('')
    } else {
      setStatus('error')
      setText(t('balanceFailed'))
      setDetail('')
      setHint(result.message)
    }
  }, [apiKey, t])

  useEffect(() => {
    void load()
    return () => controllerRef.current?.abort()
    // apiKey 变化时重新查询，其余情况不重复请求
  }, [load])

  return (
    <SettingCell
      label={t('settingsBalance')}
      description={hint || detail || undefined}
      status={null}
      action={
        <div className={styles.balanceRow}>
          <span
            className={clsx(styles.balanceValue, status === 'error' && styles.balanceValueError)}
          >
            {status === 'idle' ? '—' : text}
          </span>
          <Button
            variant="outlined"
            size="s"
            disabled={status === 'loading'}
            onClick={() => void load()}
          >
            {t('refresh')}
          </Button>
        </div>
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <ModalCloseButton variant="outlined" size="m" autoFocus>
            {t('cancel')}
          </ModalCloseButton>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/**
 * 导入 / 导出正在进行时的状态行，替掉原本的说明文字。
 *
 * 大库导出要几十秒、导入更久，之前这段时间里界面上只有一颗变灰的按钮，
 * 用户会以为点坏了。有进度就报进度；打包和替换本地数据这两段算不出条数，
 * 也换一句话说清楚在干什么。
 */
const useBackupStatus = (job: 'export' | 'import'): Status => {
  const progress = useBackupProgress((state) =>
    state.value && state.value.job === job ? state.value : null
  )
  if (!progress) {
    return null
  }
  if (progress.stage === 'writing') {
    if (progress.unit === 'bytes' && progress.total) {
      return {
        key: 'backupExportWritingBytes',
        params: { percent: Math.round(((progress.done ?? 0) / progress.total) * 100) },
      }
    }
    if (job === 'import') {
      // 导入的收尾阶段也要把最终条数报出来，否则最后一条永远看不到
      return { key: 'backupImportWriting', params: { done: progress.done ?? 0 } }
    }
    return { key: 'backupExportWriting' }
  }
  if (job === 'export') {
    return {
      key: 'backupExportReading',
      params: { done: progress.done ?? 0, total: progress.total ?? 0 },
    }
  }
  // 解压阶段末尾会带上总数（读到多少 / 共多少），中间那些只报已读
  if (progress.total !== null) {
    return {
      key: 'backupImportReadingTotal',
      params: { done: progress.done ?? 0, total: progress.total },
    }
  }
  return { key: 'backupImportReading', params: { done: progress.done ?? 0 } }
}

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  /** 折进分组时省略标签，标题由分组负责 */
  label?: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        {label ? <div className={styles.label}>{label}</div> : null}
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const progress = useBackupStatus('import')

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={progress ?? historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const progress = useBackupStatus('export')

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    const failure = await exportToShare()
    // 用户在分享面板上取消：既不是失败，也不能提示"已导出"
    if (failure && !('canceled' in failure)) {
      setStatus(
        'key' in failure
          ? { key: 'historyExportFailed', reason: failure.key, error: true }
          : { key: 'historyExportFailed', params: { message: failure.message }, error: true }
      )
    }
    setBusy(false)
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={progress ?? status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
