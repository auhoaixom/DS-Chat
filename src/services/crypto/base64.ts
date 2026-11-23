/**
 * base64 编解码。
 *
 * 只用于存不进 IndexedDB 二进制的地方：localStorage 里的设置值、密钥来源降级时
 * 那个软件密钥。会话与附件走 `sealBytes` 直接存 `ArrayBuffer`，不经过这里——
 * 二进制转 base64 会凭空涨 33%，没必要。
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined
    out += ALPHABET[first >> 2]
    out += ALPHABET[((first & 0b11) << 4) | ((second ?? 0) >> 4)]
    out += second === undefined ? '=' : ALPHABET[((second & 0b1111) << 2) | ((third ?? 0) >> 6)]
    out += third === undefined ? '=' : ALPHABET[third & 0b111111]
  }
  return out
}

/** 忽略填充与空白；解出的长度按实际字节数裁，不留尾部零字节 */
export const fromBase64 = (text: string): Uint8Array => {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4) + 2)
  let buffer = 0
  let bits = 0
  let written = 0
  for (const char of clean) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) {
      continue
    }
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[written] = (buffer >> bits) & 0xff
      written += 1
    }
  }
  return out.subarray(0, written)
}
