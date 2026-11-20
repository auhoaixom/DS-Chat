import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import {
  cancelUpload,
  isImage,
  resolveMimeType,
  uploadAttachment,
  validateFiles,
  type UploadTask,
} from '../attachments.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件与上传任务的 key */
  id: string
  file: File
  isImage: boolean
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<string | null, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null): Draft =>
  useDrafts.getState().drafts.get(sessionId) ?? EMPTY_DRAFT

const updateDraft = (sessionId: string | null, update: (draft: Draft) => Draft) =>
  useDrafts.setState((state) => {
    const draft = update(state.drafts.get(sessionId) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(sessionId, draft)
    } else {
      drafts.delete(sessionId)
    }
    return { drafts }
  })

export const setDraftText = (sessionId: string | null, text: string) =>
  updateDraft(sessionId, (draft) => ({ ...draft, text }))

const upload = (attachment: DraftAttachment, apiKey: string) => {
  // 上传任务负责记录错误，输入框的附件卡片展示失败及重试入口。
  void uploadAttachment(
    apiKey,
    attachment.id,
    attachment.file,
    attachment.file.name,
    attachment.isImage
  ).catch(() => {})
}

/** 整批校验通过后才加入草稿并开始上传。 */
export const addDraftFiles = (
  sessionId: string | null,
  files: File[],
  apiKey: string
): TranslationMessage | null => {
  if (files.length === 0) {
    return null
  }
  const error = validateFiles(files, getDraft(sessionId).attachments.length)
  if (error) {
    return error
  }
  const added = files.map(
    (file): DraftAttachment => ({
      id: createId(),
      file,
      isImage: isImage(resolveMimeType(file)),
    })
  )
  updateDraft(sessionId, (draft) => ({ ...draft, attachments: [...draft.attachments, ...added] }))
  added.forEach((attachment) => upload(attachment, apiKey))
  return null
}

export const retryDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  apiKey: string
) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (attachment) {
    upload(attachment, apiKey)
  }
}

/**
 * 裁剪后替换草稿里的原件：沿用同一个附件 id，取消旧上传并用新文件重新上传，
 * 这样草稿里的顺序和位置不变，上传状态也能跟着刷新。
 */
export const replaceDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  file: File,
  apiKey: string
): TranslationMessage | null => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return null
  }
  // 只校验文件本身（大小、格式），数量不增加
  const error = validateFiles([file], 0)
  if (error) {
    return error
  }
  cancelUpload(attachment.id)
  const next: DraftAttachment = {
    ...attachment,
    file,
    isImage: isImage(resolveMimeType(file)),
  }
  updateDraft(sessionId, (draft) => ({
    ...draft,
    attachments: draft.attachments.map((item) => (item.id === attachmentId ? next : item)),
  }))
  upload(next, apiKey)
  return null
}

/** 发送按钮和实际提交共用规则：有内容，且全部附件已上传成功。 */
export const prepareDraftMessage = (draft: Draft, tasks: Record<string, UploadTask>) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { serverId: string; blob: Blob })[] = []
  for (const attachment of draft.attachments) {
    const task = tasks[attachment.id]
    if (task?.status !== 'done' || !task.serverId) {
      return null
    }
    files.push({
      id: attachment.id,
      serverId: task.serverId,
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
      mimeType: resolveMimeType(attachment.file),
      blob: attachment.file,
    })
  }
  return { text, files }
}

/** 删除附件；返回被删的附件与所在位置，便于「撤销」时原样放回 */
export const removeDraftAttachment = (
  sessionId: string | null,
  attachmentId: string
): { attachment: DraftAttachment; index: number } | null => {
  const draft = getDraft(sessionId)
  const index = draft.attachments.findIndex((item) => item.id === attachmentId)
  if (index < 0) {
    return null
  }
  const attachment = draft.attachments[index]
  cancelUpload(attachment.id)
  updateDraft(sessionId, (state) => ({
    ...state,
    attachments: state.attachments.filter((item) => item.id !== attachmentId),
  }))
  return { attachment, index }
}

/** 撤销删除：按原来的位置放回，并重新开始上传 */
export const restoreDraftAttachment = (
  sessionId: string | null,
  attachment: DraftAttachment,
  index: number,
  apiKey: string
) => {
  updateDraft(sessionId, (draft) => {
    const attachments = [...draft.attachments]
    attachments.splice(Math.min(index, attachments.length), 0, attachment)
    return { ...draft, attachments }
  })
  upload(attachment, apiKey)
}

/** 发送成功后原件与 serverId 已交给会话，保留上传完成态。 */
export const clearSentDraft = (sessionId: string | null) => {
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿及上传任务。 */
export const clearDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => cancelUpload(attachment.id))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach((attachment) => cancelUpload(attachment.id))
  }
  useDrafts.setState({ drafts: new Map() })
}
