import { Capacitor, registerPlugin } from '@capacitor/core'
import { fromBase64, toBase64 } from './base64.js'

/**
 * 数据密钥（DEK）的来源。
 *
 * 真机：`SecureKey` 插件从 Android Keystore 取出被硬件密钥包住的那份 DEK。
 * 硬件里的密钥不能导出、只有签名对得上的这个 App 能调用它解密，因此
 * **把 app_webview 目录拷到任何别的机器上，都凑不出这把钥匙**。
 *
 * 浏览器开发与 Node 测试：没有 Keystore，退化成 localStorage 里一份随机 32 字节。
 * 安全性等同「没有」，但代码路径与真机完全一致（同一套 seal/open），
 * 所以单元测试测到的就是真机跑的那条路。
 *
 * 这里的取舍要如实写在 README 里：Keystore 包住 DEK、DEK 交给 JS 用，
 * 是为了让加解密走 WebCrypto 的原生快路径（每次读写都过一遍原生桥会慢到不能用）。
 * DEK 因此会出现在 JS 内存里，但不落盘、不进日志。
 */

interface SecureKeyPlugin {
  getDataKey(): Promise<{ key: string }>
}

const SecureKey = registerPlugin<SecureKeyPlugin>('SecureKey')

/** 软件模式密钥的存放键；真机走 Keystore 时不会用到它 */
const SOFTWARE_KEY = 'ds-chat:dek'

export type KeySource = 'hardware' | 'software' | 'unknown'

let cached: Promise<CryptoKey> | null = null
let source: KeySource = 'unknown'

const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存不下就只在本次运行里有效：数据本身还是会加密，只是重启后解不开，
    // 所以下面 importKey 之前先确保写成功了；写不成功按失败处理更安全。
    throw new Error('unable to persist the software data key')
  }
}

const importKey = (raw: Uint8Array): Promise<CryptoKey> => {
  if (raw.byteLength !== 32) {
    throw new Error(`data key must be 32 bytes, got ${raw.byteLength}`)
  }
  // 与 seal.ts 同一条理由：TS 把缓冲算成 ArrayBufferLike，WebCrypto 只收 ArrayBuffer。
  const source = raw as unknown as BufferSource
  return globalThis.crypto.subtle.importKey('raw', source, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** 浏览器与测试环境：一把随机的软件密钥，存在 localStorage 里 */
const softwareKey = (): Promise<CryptoKey> => {
  const saved = readLocal(SOFTWARE_KEY)
  if (saved) {
    return importKey(fromBase64(saved))
  }
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32))
  writeLocal(SOFTWARE_KEY, toBase64(raw))
  return importKey(raw)
}

/** 插件报「这个设备上取不到 Keystore」才降级；其他错误说明是别的问题，不能掩盖 */
const isKeystoreUnavailable = (error: unknown): boolean =>
  error instanceof Error && /KEYSTORE_UNAVAILABLE/.test(error.message)

const createKey = async (): Promise<CryptoKey> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const { key } = await SecureKey.getDataKey()
      const imported = await importKey(fromBase64(key))
      source = 'hardware'
      return imported
    } catch (error) {
      if (!isKeystoreUnavailable(error)) {
        throw error
      }
      // 设备上没有可用的安全硬件：继续用软件密钥，但把来源记成 software，
      // 诊断页据此把这一行标成警示色，用户至少知道当前是哪种强度。
    }
  }
  source = 'software'
  return softwareKey()
}

/**
 * 取数据密钥；结果在模块内缓存，同一进程只算一次。
 * 失败时把缓存清掉，允许界面重试——和 db.ts 打开连接的处理一致。
 */
export const getDataKey = (): Promise<CryptoKey> =>
  (cached ??= createKey().catch((error: unknown) => {
    cached = null
    throw error
  }))

/** 已确定的来源；还没取过密钥时是 unknown */
export const keySourceKind = (): KeySource => source

/** 供测试重置模块状态 */
export const resetKeySourceForTest = () => {
  cached = null
  source = 'unknown'
}
