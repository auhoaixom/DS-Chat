import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/** 浏览器里沿用 <a download> 触发普通下载 */
const downloadInBrowser = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 原生 Filesystem 的写入接口只接受 Base64 字符串：
 * 直接把 Blob 传过去会在参数校验阶段失败（writeFile input parameters aren't valid）。
 */
const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unable to read blob'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read blob'))
    reader.readAsDataURL(blob)
  })

/**
 * 把 Blob 交给系统处理。
 * 原生容器没有下载管理器接管 <a download>，也没有可用于 _blank 的窗口管理，
 * 因此写入应用缓存目录后交给系统分享面板：用户可以存到文件管理器，或选择其他应用打开。
 * 导出 ZIP 与打开 PDF / 文档共用这一条路径。
 */
export const shareBlob = async (blob: Blob, name: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(blob, name)
    return
  }
  const data = await toBase64(blob)
  await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Cache,
  })
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache })
  await Share.share({ title: name, files: [uri] })
}
