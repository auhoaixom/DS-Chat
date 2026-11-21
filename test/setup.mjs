/**
 * Node 里没有 WebView 提供的东西，补最小实现让被测模块能加载：
 * - __API_ORIGIN__ 由 rspack 的 DefinePlugin 注入，客户端模块在顶层就会读它；
 * - settings 模块在创建 store 时读 localStorage；
 * - store 的读写全走 IndexedDB，用 fake-indexeddb 在 Node 里提供一份实现。
 *
 * IndexedDB 这一条是**真实实现**而不是替身：会话的写回纪律、事务、游标都在 db.ts 里，
 * 替掉它等于把最该测的部分测没了。
 */

import 'fake-indexeddb/auto'

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
