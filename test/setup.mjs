/**
 * Node 里没有 WebView 提供的东西，补最小实现让被测模块能加载：
 * - __API_ORIGIN__ 由 rspack 的 DefinePlugin 注入，客户端模块在顶层就会读它；
 * - settings 模块在创建 store 时读 localStorage。
 */

globalThis.__API_ORIGIN__ = 'https://api.example.test'

const store = new Map()

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(key, String(value))
  },
  removeItem: (key) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size
  },
}
