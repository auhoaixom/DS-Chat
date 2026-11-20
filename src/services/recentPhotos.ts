import { Capacitor, registerPlugin } from '@capacitor/core'

/** none 未授权；limited 只允许访问选中的照片（Android 14+）；full 全部授权 */
export type PhotosAccess = 'none' | 'limited' | 'full' | 'unsupported'

type RecentPhoto = { id: string; name: string; thumbnail: string }

interface RecentPhotosPlugin {
  check(): Promise<{ state: 'none' | 'limited' | 'full' }>
  request(): Promise<{ state: 'none' | 'limited' | 'full' }>
  list(options: { limit?: number }): Promise<{ photos: RecentPhoto[] }>
  read(options: { id: string }): Promise<{ path: string; name: string; size: number; mime: string }>
}

const RecentPhotos = registerPlugin<RecentPhotosPlugin>('RecentPhotos')

/** 面板里一格照片：url 可直接给 <img> 用 */
export type RecentPhotoItem = { id: string; name: string; url: string }

export const isRecentPhotosSupported = () => Capacitor.isNativePlatform()

export const checkPhotosAccess = async (): Promise<PhotosAccess> => {
  if (!Capacitor.isNativePlatform()) {
    return 'unsupported'
  }
  try {
    const { state } = await RecentPhotos.check()
    return state
  } catch {
    return 'unsupported'
  }
}

export const requestPhotosAccess = async (): Promise<PhotosAccess> => {
  if (!Capacitor.isNativePlatform()) {
    return 'unsupported'
  }
  try {
    const { state } = await RecentPhotos.request()
    return state
  } catch {
    return 'none'
  }
}

/** 最近的照片（新到旧），缩略图已缓存到应用目录 */
export const listRecentPhotos = async (limit = 18): Promise<RecentPhotoItem[]> => {
  try {
    const { photos } = await RecentPhotos.list({ limit })
    return photos.map((photo) => ({
      id: photo.id,
      name: photo.name,
      url: Capacitor.convertFileSrc(photo.thumbnail),
    }))
  } catch {
    return []
  }
}

/** 把点选的原图取成 File，与相册选择器拿到的附件走同一条上传路径 */
export const loadRecentPhoto = async (id: string): Promise<File | null> => {
  try {
    const { path, name, mime } = await RecentPhotos.read({ id })
    const response = await fetch(Capacitor.convertFileSrc(path))
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    return new File([blob], name, { type: mime || blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}
