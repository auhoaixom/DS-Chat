import { useEffect, useState } from 'react'
import { getFileViewType, isImage } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import { shareBlob } from '../../services/exportFile.js'
import { showToast } from '../base/toastState.js'
import { useFilePreview } from './filePreviewState.js'

const createViewUrl = (original: Blob, type: string) => {
  const blob = original.slice(0, original.size, type || 'application/octet-stream')
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

type ViewState = {
  source: File | string
  type: string
  url: string | null
  blob: Blob | null
}

/**
 * 草稿传 File，已发送的附件传 IndexedDB 原件 ID。
 *
 * 打开方式在原生容器里必须绕开浏览器语义：
 * 图片交给应用内预览层（`_blank` 会开出没有关闭入口的窗口），
 * 其余文件写入缓存后交给系统分享面板（`<a download>` 在 WebView 里没有接收方）。
 */
export const useFileView = (source: File | string, name: string, onCrop?: () => void) => {
  const type = getFileViewType(name)
  const showPreview = useFilePreview((state) => state.open)
  const [state, setState] = useState<ViewState>()
  useEffect(() => {
    let active = true
    const original = typeof source === 'string' ? loadFile(source) : Promise.resolve(source)
    const pending = original
      .then(async (blob) => {
        if (!active || !blob) {
          return null
        }
        return { url: await createViewUrl(blob, type), blob }
      })
      .catch(() => null)
    void pending.then((result) => {
      if (active) {
        setState({ source, type, url: result?.url ?? null, blob: result?.blob ?? null })
      }
    })
    return () => {
      active = false
      void pending.then((result) => {
        if (result?.url.startsWith('blob:')) {
          URL.revokeObjectURL(result.url)
        }
      })
    }
  }, [source, type])

  const current = state?.source === source && state.type === type ? state : undefined
  const url = current?.url
  const image = isImage(type)
  const open = !url
    ? undefined
    : image
      ? () => showPreview(url, name, onCrop)
      : () => {
          const blob = current?.blob
          if (blob) {
            void shareBlob(blob, name).catch(() => showToast({ key: 'fileOpenFailed' }))
          }
        }
  return { url, image, open }
}
