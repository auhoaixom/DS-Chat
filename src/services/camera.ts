import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { translate } from '../i18n/index.js'
import { ACCEPT_FILE_EXTS } from './uploadExts.js'

/** 拍照或选图的结果：null 表示用户取消，其余失败按原因分类交给调用方提示。 */
export type PhotoPick = { file: File } | { error: 'denied' | 'failed' | 'unsupported' } | null

/** 相机返回的格式名与附件白名单扩展名的对应关系 */
const EXT_BY_FORMAT: Record<string, string> = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
}

/**
 * 让用户拍照或从相册选一张图，返回可直接加入草稿的 File。
 *
 * 走系统的「拍照 / 从相册选择」对话框：拍照是 ACTION_IMAGE_CAPTURE，
 * 选图在 Android 13+ 是 Photo Picker，均不经过本应用的存储目录。
 * quality 85 把常见 4000×3000 原图压到 1 MB 量级，兼顾识别质量与上传耗时。
 */
export const pickPhoto = async (): Promise<PhotoPick> => {
  try {
    const permission = await Camera.requestPermissions({ permissions: ['camera', 'photos'] })
    if (permission.camera === 'denied') {
      return { error: 'denied' }
    }
  } catch {
    // 权限查询失败不阻断：直接尝试打开，失败原因在下方统一归类
  }

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>
  try {
    photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      promptLabelHeader: translate('cameraPromptHeader'),
      promptLabelPhoto: translate('cameraPromptLibrary'),
      promptLabelPicture: translate('cameraPromptTake'),
      promptLabelCancel: translate('cameraPromptCancel'),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/cancel/i.test(message)) {
      return null
    }
    if (/denied|permission/i.test(message)) {
      return { error: 'denied' }
    }
    return { error: 'failed' }
  }

  const format = (photo.format ?? '').toLowerCase()
  const ext = EXT_BY_FORMAT[format]
  if (!ext || !ACCEPT_FILE_EXTS.includes(ext)) {
    return { error: 'unsupported' }
  }
  if (!photo.webPath) {
    return { error: 'failed' }
  }

  try {
    const blob = await (await fetch(photo.webPath)).blob()
    const name = `photo-${Date.now()}.${ext}`
    return { file: new File([blob], name, { type: blob.type || `image/${format}` }) }
  } catch {
    return { error: 'failed' }
  }
}
