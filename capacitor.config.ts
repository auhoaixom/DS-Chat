import type { CapacitorConfig } from '@capacitor/cli'

/**
 * DS Chat 的 Capacitor 配置。
 *
 * `androidScheme: 'https'` 必须保持 https：安卓端页面 origin 会是 `https://localhost`，
 * IndexedDB / localStorage 才可用（file:// 的 null origin 会让整个会话存储失效），
 * 且该 origin 已被 DeepSeek API 的 CORS 预检放行，可以直接流式请求。
 */
const config: CapacitorConfig = {
  appId: 'com.dschat.app',
  appName: 'DS Chat',
  webDir: 'dist',
  android: {
    // 不做混合内容放行：接口与页面都是 https
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
