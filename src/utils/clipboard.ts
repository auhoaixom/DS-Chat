import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeClipboardPlugin {
  write(options: { text: string }): Promise<void>
}

const NativeClipboard = registerPlugin<NativeClipboardPlugin>('NativeClipboard')

/** 原生容器里直接写系统剪贴板：不依赖 WebView 焦点与网页剪贴板权限 */
const writeNative = async (text: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false
  }
  try {
    await NativeClipboard.write({ text })
    return true
  } catch {
    return false
  }
}

/**
 * 复制文本。
 * 优先走原生剪贴板：网页侧的两条路都要求 WebView 有焦点
 * （长按时系统选区栏抢走焦点就会失败），原生接口没有这个前提。
 * 浏览器里没有原生通道，退回 navigator.clipboard 与 execCommand。
 */
export const copyText = async (text: string): Promise<boolean> => {
  if (await writeNative(text)) {
    return true
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板权限受限时尝试兼容方式。
  }

  // 兼容手机通过局域网 HTTP 访问的情况。
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'

  try {
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
