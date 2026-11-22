import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  IconGlobeLanguageOutline14,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  replaceDraftAttachment,
  restoreDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { capturePhoto } from '../../services/camera.js'
import { cropImage } from '../camera/cropState.js'
import { openInAppCamera } from '../camera/inAppCameraState.js'
import { useFilePreview } from '../files/filePreviewState.js'
import { AttachPanel, type AttachSource } from './AttachPanel.js'
import { closeAttachPanel, toggleAttachPanel, useAttachPanelOpen } from './attachPanelState.js'
import { keyboardDismissed } from './keyboardViewport.js'
import { loadRecentPhoto, type RecentPhotoItem } from '../../services/recentPhotos.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const panelOpen = useAttachPanelOpen()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }
    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  // 点输入框与面板以外的地方收起附件面板（键盘也是这样收的）
  useEffect(() => {
    if (!panelOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-attach-scope]')) {
        return
      }
      closeAttachPanel()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [panelOpen])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (useChatStore.getState().importingHistory) {
        return
      }
      const removed = removeDraftAttachment(sessionId, id)
      if (!removed) {
        return
      }
      // 缩略图右上角的删除热区很容易被拇指蹭到：给一次后悔的机会
      showToast(
        { key: 'attachmentRemoved' },
        {
          key: 'undo',
          onClick: () => {
            restoreDraftAttachment(
              sessionId,
              removed.attachment,
              removed.index,
              useSettings.getState().apiKey ?? ''
            )
          },
        }
      )
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && draftReady

  /**
   * 不让按钮抢走输入框的焦点。
   *
   * `pointerdown` 的默认行为就是把焦点移到被按的元素上；焦点一离开输入框，
   * 安卓 WebView 立刻收起软键盘 —— 用户点一下「深度思考」，还得再点回输入框。
   * 拦掉默认行为即可：焦点不动、键盘不动，`click` 之后照常触发，开关本身不受影响。
   */
  const keepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault()
  }

  /**
   * 「＋」展开附件面板（拍照 / 相册 / 文件），面板占住键盘的位置。
   * 再点一次收起面板，并把焦点还给输入框 —— 键盘跟着回来，光标停在原来的位置。
   * 不做防重入：相机被系统返回键关闭时 Capacitor 的回调可能不返回，
   * 死锁的标记会永久挡住这个入口；面板本身已经挡住重复点击。
   */
  const openAttach = () => {
    if (importingHistory || !ensureApiKey()) {
      return
    }
    if (panelOpen) {
      closeAttachPanel()
      /**
       * 收起面板要把焦点还给输入框，键盘才会回来。
       *
       * 必须在**这一次点击里**同步聚焦：安卓只在这种情况下弹软键盘；
       * 放到 effect 或定时器里再聚焦，焦点回来了、键盘不弹（实测）。
       * 后面那次 rAF 是兜底 —— 面板卸载有几率把焦点带回 body。
       */
      textareaRef.current?.focus({ preventScroll: true })
      requestAnimationFrame(() => {
        if (document.activeElement !== textareaRef.current) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      })
      return
    }
    textareaRef.current?.blur()
    toggleAttachPanel()
  }

  /**
   * 软键盘被收起时，把焦点也一并放掉。
   *
   * 用键盘上那个「收起」键，IME 只是藏起来，`textarea` 仍然聚焦 —— 于是一个没有键盘、
   * 却还在吃输入的状态留在那儿（点别处收起时焦点是走的，两种方式表现不一致）。
   * WebView 不会为这件事发事件，只能盯 `visualViewport` 的高度回弹。
   */
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) {
      return
    }
    let height = viewport.height
    const onResize = () => {
      const next = viewport.height
      const dismissed = keyboardDismissed(height, next)
      height = next
      if (dismissed && document.activeElement === textareaRef.current) {
        textareaRef.current?.blur()
      }
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [])

  /** 面板里的三个入口：先收起面板，再走各自的取图 / 取文件流程 */
  const pickAttachment = (source: AttachSource) => {
    closeAttachPanel()
    if (source === 'camera') {
      void takePhoto()
    } else if (source === 'album') {
      openImagePicker()
    } else {
      openFilePicker()
    }
  }

  /** 最近照片条里点一张：取原图直接入草稿，面板保持打开方便连选 */
  const pickRecentPhoto = async (photo: RecentPhotoItem) => {
    const file = await loadRecentPhoto(photo.id)
    if (!file) {
      showToast({ key: 'photoLoadFailed' })
      return
    }
    acceptFiles([file])
  }

  /**
   * 拍照：默认用自建相机（拍完直接进裁剪，没有系统相机那个确认页）。
   * 裁剪页点「取消」只放弃这张照片、重新回到相机；在相机里关闭则结束整个流程。
   * 自建相机不可用（老 WebView 或没有可用摄像头）时退回系统相机。
   */
  const takePhoto = async () => {
    for (;;) {
      const shot = await openInAppCamera()
      if (!shot) {
        return
      }
      if ('error' in shot) {
        if (shot.error === 'unsupported') {
          await takeSystemPhoto()
          return
        }
        showToast({ key: shot.error === 'denied' ? 'cameraPermissionDenied' : 'cameraFailed' })
        return
      }
      if (await addCroppedPhoto(shot.file)) {
        return
      }
    }
  }

  /** 裁剪并加入草稿；返回 false 表示用户取消裁剪，需要回到相机重拍 */
  const addCroppedPhoto = async (file: File): Promise<boolean> => {
    // 裁剪框没动过时直接用原图
    const cropped = await cropImage(file)
    if (!cropped) {
      return false
    }
    const error = addDraftFiles(sessionId, [cropped], useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
    return true
  }

  /** 兜底：自建相机打不开时仍用系统相机 */
  const takeSystemPhoto = async () => {
    for (;;) {
      let result: Awaited<ReturnType<typeof capturePhoto>>
      try {
        result = await capturePhoto()
      } catch {
        showToast({ key: 'cameraFailed' })
        return
      }
      // null 表示在系统相机里取消，结束流程
      if (!result) {
        return
      }
      if ('error' in result) {
        showToast({
          key:
            result.error === 'denied'
              ? 'cameraPermissionDenied'
              : result.error === 'unsupported'
                ? 'uploadUnsupportedFormat'
                : 'cameraFailed',
        })
        return
      }
      if (await addCroppedPhoto(result.file)) {
        return
      }
    }
  }

  /**
   * 相册走 WebView 原生的 file input：
   * 不需要相册读取权限，系统会给出「照片/文件」来源选择，并且支持多选。
   */
  const openImagePicker = () => {
    if (!ensureApiKey()) {
      return
    }
    imageInputRef.current?.click()
  }

  /** 文件走 WebView 原生的 file input，白名单由 ACCEPT 控制 */
  const openFilePicker = () => {
    if (!ensureApiKey()) {
      return
    }
    fileInputRef.current?.click()
  }

  /** 放大预览后裁剪草稿附件：结果替换同一个附件并重新上传。 */
  const cropDraft = async (id: string) => {
    const attachment = getDraft(sessionId).attachments.find((item) => item.id === id)
    if (!attachment) {
      return
    }
    useFilePreview.getState().close()
    const cropped = await cropImage(attachment.file)
    if (!cropped) {
      return
    }
    const error = replaceDraftAttachment(
      sessionId,
      id,
      cropped,
      useSettings.getState().apiKey ?? ''
    )
    if (error) {
      showToast(error)
    }
  }

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    closeAttachPanel()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <>
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        data-attach-scope
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
      <DraftAttachments
        items={attachments}
        onRetry={retryFile}
        onRemove={removeFile}
        onCrop={(id) => void cropDraft(id)}
      />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          // 点输入框等于要用键盘：先收附件面板
          onFocus={() => closeAttachPanel()}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              // 不让按钮抢走输入框的焦点：焦点一丢，安卓就把软键盘收起来，
              // 用户点一下开关还得再点回输入框才能接着打字。
              // click 在 pointerdown 被 preventDefault 之后照常触发，开关本身不受影响。
              onPointerDown={keepFocus}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onPointerDown={keepFocus}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            hidden
            accept="image/*"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {/* 相机与文件合并成一个「＋」，展开后是拍照 / 相册 / 文件三块 */}
          <button
            type="button"
            className={clsx(styles.attachButton, panelOpen && styles.attachButtonOpen)}
            aria-label={t('attachMore')}
            aria-expanded={panelOpen}
            disabled={importingHistory}
            onClick={openAttach}
          >
            <IconPlusOutline16 />
          </button>
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
      </div>
      {panelOpen ? (
        <AttachPanel onPick={pickAttachment} onPickPhoto={(photo) => void pickRecentPhoto(photo)} />
      ) : null}
    </>
  )
}
