import { fromBase64, toBase64 } from './base64.js'
import { getDataKey } from './keySource.js'

/**
 * 本地数据的加密原语。
 *
 * 这里刻意**只知道字节**：不认 Session、不碰 IndexedDB、不管内容长什么样。
 * 会话正文只是在外层套一层 JSON，将来的附件直接传字节走同一对函数——
 * 不新增第二套实现，这是「以后要扩到附件」那条路能走通的前提。
 *
 * 算法用 WebCrypto 的 AES-256-GCM：
 * - 原生实现，安卓上是 ARMv8 的加密指令，几 MB 毫秒级，比自己写的 ChaCha20 快一个量级；
 * - 自带完整性校验（16 字节 tag），不用手工拼 MAC，也不用拿同一把 key 既加密又签名；
 * - nonce 12 字节随机，一条记录一个。
 *
 * 载荷格式（二进制）：version(1) | nonce(12) | ciphertext | tag(16)
 * 首字节是格式版本，将来加口令解锁时是 3，`openBytes` 里多一个分支就能同时读旧格式。
 *
 * 附加数据（AAD）取记录的 id：把 A 会话的密文挪到 B 会话上，解密直接失败。
 * 代价为零，挡掉一整类「拼接密文」的玩法。
 */

/** 写入时的载荷版本 */
const PAYLOAD_VERSION = 2
const NONCE_BYTES = 12
const TAG_BYTES = 16
/** localStorage 里的字符串形态前缀；与二进制形态是同一份载荷 */
const TEXT_PREFIX = 'ds2:'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const subtle = (): SubtleCrypto => {
  const api = globalThis.crypto?.subtle
  if (!api) {
    throw new Error('WebCrypto is unavailable')
  }
  return api
}

const asBytes = (sealed: ArrayBuffer | Uint8Array): Uint8Array =>
  sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed)

/**
 * TypeScript 把 Uint8Array 的底层缓冲算成 `ArrayBufferLike`（可能指向 SharedArrayBuffer），
 * 而 WebCrypto 只接受 `ArrayBuffer`。运行时这里从来拿不到共享缓冲，
 * 所以直接断言——不要 copy 一份，大载荷会白白多一次全量内存拷贝。
 */
const asBuffer = (view: Uint8Array): BufferSource => view as unknown as BufferSource

/** AAD 只在给出 id 时启用；空串等价于没有 */
const additionalData = (aad?: string): BufferSource | undefined =>
  aad ? asBuffer(encoder.encode(aad)) : undefined

export const sealBytes = async (plain: Uint8Array, aad?: string): Promise<ArrayBuffer> => {
  const key = await getDataKey()
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(aad), tagLength: 128 },
    key,
    asBuffer(plain)
  )
  const payload = new Uint8Array(1 + NONCE_BYTES + cipher.byteLength)
  payload[0] = PAYLOAD_VERSION
  payload.set(nonce, 1)
  payload.set(new Uint8Array(cipher), 1 + NONCE_BYTES)
  return payload.buffer
}

export const openBytes = async (
  sealed: ArrayBuffer | Uint8Array,
  aad?: string
): Promise<Uint8Array> => {
  const payload = asBytes(sealed)
  if (payload.byteLength < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('sealed payload is truncated')
  }
  if (payload[0] !== PAYLOAD_VERSION) {
    throw new Error(`unsupported sealed payload version: ${payload[0]}`)
  }
  const plain = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: asBuffer(payload.subarray(1, 1 + NONCE_BYTES)),
      additionalData: additionalData(aad),
      tagLength: 128,
    },
    await getDataKey(),
    asBuffer(payload.subarray(1 + NONCE_BYTES))
  )
  return new Uint8Array(plain)
}

/** localStorage 用：`ds2:` + base64(二进制载荷) */
export const sealText = async (text: string, aad?: string): Promise<string> =>
  TEXT_PREFIX + toBase64(new Uint8Array(await sealBytes(encoder.encode(text), aad)))

/**
 * 读回字符串；**不是 `ds2:` 开头一律返回 null**，表示这是明文或本程序不认识的格式，
 * 由调用方决定当成旧值用还是当成坏值。这里不擅自把密文当明文返回，
 * 那样等于给「把密文换成明文」留了一条降级通道。
 */
export const openText = async (value: string, aad?: string): Promise<string | null> => {
  if (!value.startsWith(TEXT_PREFIX)) {
    return null
  }
  return decoder.decode(await openBytes(fromBase64(value.slice(TEXT_PREFIX.length)), aad))
}

/** 这个值是不是本程序写下的密文（字符串形态） */
export const isSealedText = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(TEXT_PREFIX)

/** 这个值是不是本程序写下的密文（二进制形态，IndexedDB 里） */
export const isSealedBytes = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer

/** 给测试与诊断用：不做解密也能判断一条记录有没有加密过 */
export const sealedTextPrefix = TEXT_PREFIX
