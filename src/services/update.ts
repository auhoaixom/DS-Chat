/**
 * 检测更新。
 *
 * 和余额一样：不碰 UI、不碰 store，网络函数从参数进来，好在测试里喂假响应。
 * 只在用户点「检查」的那一刻发一次请求——不进开机流程、不进后台、结果也不落盘。
 *
 * 请求打的是 GitHub 的公开 Release 接口，不带任何用户信息；未认证限流
 * 60 次/小时/IP，对"手点一下"这个量级完全够用，但共用出口 IP 时仍可能撞上，
 * 所以 403/429 单独成一档，提示语说的是"过一会再试"而不是"出错了"。
 */

/** 仓库首页：给作者点 star 用 */
export const REPO_URL = 'https://github.com/auhoaixom/DS-Chat'
/** Release 列表：查不到更新时的兜底去处 */
export const RELEASES_URL = `${REPO_URL}/releases`
/** 最新一个 Release；返回体里带 tag_name 与 assets */
export const LATEST_API = 'https://api.github.com/repos/auhoaixom/DS-Chat/releases/latest'

/** 只用到这三个字段，测试里的假响应不必凑出一个完整的 Response */
type FetchLike = (
  url: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>

/** 一次检查的结果；UI 只负责按 kind 渲染，判断全在这一层 */
export type CheckOutcome =
  | { kind: 'available'; version: string; downloadUrl: string | null }
  | { kind: 'latest' }
  | { kind: 'failed'; reason: 'network' | 'rate' | 'bad' }

export type LatestRelease = { version: string; downloadUrl: string | null }

/**
 * 版本号拆成数字段。
 *
 * `v` 前缀、预发布标记（`-beta.1`）与构建元数据（`+build`）都不参与比较：
 * 先切掉它们，再按点分段。所以 `1.6.0-beta.1` 与 `1.6.0` 是同一个版本——
 * 我们只关心"第几版"，不关心它是第几个测试候选。整段取不出数字就返回 null，
 * 那种输入不该拿来比大小。
 */
const versionParts = (value: string): number[] | null => {
  const segments = value.trim().replace(/^[vV]/, '').split(/[-+]/)[0].split('.')
  const parts: number[] = []
  for (const segment of segments) {
    const match = /^\d+/.exec(segment.trim())
    if (!match) {
      return null
    }
    parts.push(Number(match[0]))
  }
  return parts
}

/**
 * 比较两个版本号：`a` 比 `b` 新返回 1，相同返回 0，更旧返回 -1。
 *
 * 段数不同按补零处理（`1.5` 与 `1.5.0` 相等）。任一侧无法解析时返回 0 ——
 * 也就是说"判断不了"一律当成"没有更新"。宁可漏报一次，也不拿一个编出来的
 * 版本号去催用户下载。
 */
export const compareVersions = (a: string, b: string): number => {
  const left = versionParts(a)
  const right = versionParts(b)
  if (!left || !right) {
    return 0
  }
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference > 0 ? 1 : -1
    }
  }
  return 0
}

/**
 * 从 Release 返回体里取版本号与 APK 地址。
 *
 * `downloadUrl` 允许是 null：Release 里没挂 apk 时，界面要把「去更新」换回
 * 「去发布页」——否则按钮点下去是个空链接，比不给按钮更糟。
 */
export const parseRelease = (body: unknown): LatestRelease | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const record = body as Record<string, unknown>
  const version = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
  if (!version) {
    return null
  }
  const assets = Array.isArray(record.assets) ? record.assets : []
  let downloadUrl: string | null = null
  for (const asset of assets) {
    if (typeof asset !== 'object' || asset === null) {
      continue
    }
    const entry = asset as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name.toLowerCase() : ''
    const url = entry.browser_download_url
    if (name.endsWith('.apk') && typeof url === 'string' && url !== '') {
      downloadUrl = url
      break
    }
  }
  return { version, downloadUrl }
}

/**
 * 查一次最新版本，和 `current` 比。
 *
 * 超时与外部取消共用一个 controller：对界面来说两者都是"这次没查成"，
 * 不必分开。8 秒是很宽的上限——实测首次连接（含 DNS 与 TLS）约 2.8 秒。
 */
export const checkForUpdate = async (
  current: string,
  options: { fetchImpl?: FetchLike; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<CheckOutcome> => {
  const { fetchImpl = fetch, signal, timeoutMs = 8000 } = options
  if (signal?.aborted) {
    return { kind: 'failed', reason: 'network' }
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  const timer = setTimeout(abort, timeoutMs)
  try {
    const response = await fetchImpl(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (response.status === 403 || response.status === 429) {
      return { kind: 'failed', reason: 'rate' }
    }
    if (!response.ok) {
      return { kind: 'failed', reason: 'bad' }
    }
    let body: unknown
    try {
      body = JSON.parse(await response.text())
    } catch {
      return { kind: 'failed', reason: 'bad' }
    }
    const release = parseRelease(body)
    if (!release) {
      return { kind: 'failed', reason: 'bad' }
    }
    return compareVersions(release.version, current) > 0
      ? { kind: 'available', version: release.version, downloadUrl: release.downloadUrl }
      : { kind: 'latest' }
  } catch {
    return { kind: 'failed', reason: 'network' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
