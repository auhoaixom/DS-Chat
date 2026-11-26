import { countTokens } from '../api/client.js'
import * as db from './db.js'
import type { FileAttachment } from './types.js'

/**
 * 附件在上下文里到底值多少 token。
 *
 * 占位值（图 1500、文档 2000）是按"偏大估、宁可提前压缩"定的，但实测差得很远：
 * 一张 53 970 B 的 PNG 真实只值 226（高估 8 倍），一份 1 696 B 的 txt 真实 599
 * （占位 2000，反而高估 3 倍多）——占位值既不敢调小（大图确实能到几千），
 * 也调不准（同一类别内部差异极大）。
 *
 * 所以改成"能问就问、问不到就反推"：
 *
 * - **图片**：上传成功拿到 `file_id` 后调一次 `count_tokens`，服务端给的数与计费一字不差。
 * - **文档**：`count_tokens` 只算"文件挂在这"的壳子，用不了；改为第一次真发之后用
 *   `实测 − 这次请求的估算 + 占位值` 反推出真实开销，写进缓存，此后一直用它。
 *
 * 两者都存在 `meta` 表（`file-tokens:<file_id>`），不进会话记录，因此不会触发会话重新加密写盘；
 * 也不进导出包——换设备就退回占位值。
 */

const META_PREFIX = 'file-tokens:'

/** 图片经 Files API 展开成视觉 token 的占位值（拿到真值前用） */
export const IMAGE_TOKENS = 1_500
/** 文档按解析后的文本量差异很大，占位值取一个保守的均价（拿到真值前用） */
export const DOCUMENT_TOKENS = 2_000

/** 反推出来的总价上限：超过这个数一定是估算或服务端出了问题，宁可不写 */
const MAX_DERIVED_TOTAL = 200_000
/** 单个附件的价格上限 */
const MAX_FILE_TOKENS = 100_000
/** 服务端提示侧用量低于这个数就不可信（与 compaction.ts 的 MIN_ANCHOR_TOKENS 同一条线） */
const MIN_MEASURED_TOKENS = 32
/** 数一次 token 的等待上限；超时就当没数过，别拖住上传 */
const COUNT_TIMEOUT_MS = 5_000
/** 图片计价的总开关：万一 count_tokens 将来开始计费，把它关掉就退回占位值 */
const IMAGE_COUNT_ENABLED = true

export type FilePrice = {
  tokens: number
  /** count：服务端数出来的；derived：从一次真实请求的用量反推的 */
  source: 'count' | 'derived'
  at: number
  model?: string
}

/** 进程内缓存，启动时从 meta 水合；写失败也照用，只是重启后退回占位 */
const prices = new Map<string, FilePrice>()

/** 这个附件进上下文值多少 token：有真值用真值，没有退回占位 */
export const fileTokensOf = (file: FileAttachment): number =>
  prices.get(file.id)?.tokens ?? (file.isImage ? IMAGE_TOKENS : DOCUMENT_TOKENS)

/** 已经拿到真值的附件（诊断与测试用） */
export const knownPrice = (fileId: string): FilePrice | undefined => prices.get(fileId)

/** 启动时读一遍已存的价格；失败就当没有，一切退回占位 */
export const hydrateFileTokens = async (): Promise<void> => {
  try {
    for (const [key, value] of await db.readMetaEntries(META_PREFIX)) {
      const price = value as FilePrice | undefined
      if (!price || typeof price.tokens !== 'number' || !(price.tokens >= 0)) {
        continue
      }
      prices.set(key.slice(META_PREFIX.length), price)
    }
  } catch (error) {
    db.reportStorageError('read file token prices')(error)
  }
}

const store = async (fileId: string, price: FilePrice): Promise<void> => {
  prices.set(fileId, price)
  try {
    await db.writeMeta(META_PREFIX + fileId, price)
  } catch (error) {
    // 内存里已经有了，这次会话照常准；写不进库只影响下次启动
    db.reportStorageError('write file token price')(error)
  }
}

/**
 * 图片定价：上传成功之后问一次服务端。失败、超时、返回怪值一律静默跳过，
 * 继续用占位值——这条路径绝不能挡住发送。
 */
export const calibrateImage = async (
  apiKey: string,
  file: FileAttachment,
  serverId: string,
  model: string
): Promise<void> => {
  if (!IMAGE_COUNT_ENABLED || !file.isImage || !apiKey || prices.has(file.id)) {
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COUNT_TIMEOUT_MS)
  try {
    const tokens = await countTokens(
      apiKey,
      {
        model,
        messages: [
          { role: 'user', content: [{ type: 'image', source: { type: 'file', file_id: serverId } }] },
        ],
      },
      controller.signal
    )
    if (Number.isFinite(tokens) && tokens > 0 && tokens <= MAX_FILE_TOKENS) {
      await store(file.id, { tokens: Math.round(tokens), source: 'count', at: Date.now(), model })
    }
  } catch {
    // 数不出来就继续用占位值
  } finally {
    clearTimeout(timer)
  }
}

export type DocumentEntry = { file: FileAttachment; count: number }

export type DeriveResult = {
  /** 本次新定价的附件 */
  applied: Array<{ fileId: string; tokens: number }>
  /** 把这一枪的 promptEstimate 修正到新尺子要加的量（见下方调用点） */
  delta: number
}

/**
 * 文档定价：用一次真实请求的用量反推。
 *
 * `measured` 是服务端回报的提示侧 token；`estimate` 是我们发请求前按占位值算的同一份东西。
 * 两者只差在文档这一项上（其余部分同源相减抵掉），于是
 *
 *     derivedTotal = measured − estimate + 占位值 × 出现次数
 *
 * 就是这批文档的真实总价。按「出现次数 × 字节数」分摊到每个文件；单文档时即它的全部。
 *
 * 已知局限（写在这里免得以后当成 bug）：其余部分估算偏大时，误差会被算到文档头上，
 * 短文档可能反推出接近 0。总量仍由实测锚定，不会错；错的是这个 `file_id`
 * 在**别的会话**里的单条价格。宁可偏低也不要继续用 2000 那个凭空数。
 */
export const deriveDocumentPrices = (
  entries: DocumentEntry[],
  measured: number,
  estimate: number
): DeriveResult | null => {
  const fresh = entries.filter((entry) => !prices.has(entry.file.id) && entry.count > 0)
  if (fresh.length === 0) {
    return null
  }
  if (!Number.isFinite(measured) || measured < MIN_MEASURED_TOKENS || !Number.isFinite(estimate)) {
    return null
  }
  const placeholderTotal = fresh.reduce((sum, entry) => sum + DOCUMENT_TOKENS * entry.count, 0)
  const derivedTotal = measured - estimate + placeholderTotal
  if (!Number.isFinite(derivedTotal) || derivedTotal < 0 || derivedTotal > MAX_DERIVED_TOTAL) {
    return null
  }
  /**
   * 分摊：`p1 = derivedTotal × size / Σ(count × size)`，这样 `Σ count × p1` 正好等于总价
   * （同一个文件在一次请求里出现两次，就要摊两份，所以分母带 count、分子不带）。
   */
  const total = fresh.reduce((sum, entry) => sum + entry.count * Math.max(1, entry.file.size), 0)
  const applied: Array<{ fileId: string; tokens: number }> = []
  for (const entry of fresh) {
    const size = Math.max(1, entry.file.size)
    const share = total > 0 ? size / total : 1 / fresh.length
    const tokens = Math.min(MAX_FILE_TOKENS, Math.max(0, Math.round(derivedTotal * share)))
    applied.push({ fileId: entry.file.id, tokens })
  }
  return { applied, delta: derivedTotal - placeholderTotal }
}

/** 把反推结果落库；返回写进去了哪些（调用方据此修正 promptEstimate） */
export const commitDerivedPrices = async (
  result: DeriveResult,
  model: string
): Promise<Array<{ fileId: string; tokens: number }>> => {
  const at = Date.now()
  for (const { fileId, tokens } of result.applied) {
    await store(fileId, { tokens, source: 'derived', at, model })
  }
  return result.applied
}

/** 测试用：清空内存缓存（库里的记录不动） */
export const resetFileTokensForTest = (): void => {
  prices.clear()
}
