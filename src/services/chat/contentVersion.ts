import type { Session } from './types.js'

/**
 * 持久化内容的**语义**版本。
 *
 * 和 db.ts 里的 `DB_VERSION` 是两件事，别混：
 * - `DB_VERSION` 管 IndexedDB 的**结构**（建哪些存储、哪些索引），由 openDB 的 upgrade 回调执行，
 *   只在结构变化时才动；
 * - `CONTENT_VERSION` 管记录里**字段的含义**。加一个可选字段不用动它；字段含义变了、
 *   旧值按新含义读会读错，才递增，并在下面的迁移表里补一条把旧记录改成新含义。
 *
 * 记录上的 `schema` 就是写入时程序认为自己在用的内容版本；没有这个字段的记录一律当作版本 0。
 */
export const CONTENT_VERSION = 1

export type UpgradeResult = {
  /** 升级后的记录；**没有改动时返回同一个对象**，调用方据此判断要不要写回 */
  session: Session
  /** 记录比本程序新：这些字段的语义本程序不认识，只用不改，绝不能写回 */
  fromFuture: boolean
}

const readVersion = (session: Session): number | undefined => {
  const version = session.schema
  return typeof version === 'number' && Number.isInteger(version) && version >= 0
    ? version
    : undefined
}

/**
 * 0 → 1：版本机制之前的记录。
 *
 * 摘要正文是模型当时写出来的，本机没有原料重算，所以这里**不修正任何字段**，只标注来源：
 * 卡片据此说明这份摘要是早期版本写入的，避免把旧口径的 before/after 当成新口径。
 * 不标的话，将来真的改了口径，旧记录会静悄悄地按新含义显示。
 */
const markLegacyCompaction = (session: Session): Session => {
  const compaction = session.compaction
  if (!compaction || compaction.legacy !== undefined) {
    return session
  }
  return { ...session, compaction: { ...compaction, legacy: true } }
}

/**
 * 迁移表：`MIGRATIONS[n]` 把版本 n 的记录变成版本 n + 1。
 * 缺项表示这里没有能把旧记录升到当前版本的步骤——那种情况宁可让它停在旧版本上被当成旧记录，
 * 也不给它盖一个假的当前版本号。
 */
const MIGRATIONS: Readonly<Record<number, (session: Session) => Session>> = {
  0: markLegacyCompaction,
}

/**
 * 读出来之后、进内存之前过一遍：把旧版本的记录升到当前版本。
 *
 * 只应该在**读整条会话**时调用（`loadSession` 之后），不要在列表摘要上跑：
 * 摘要没有 messages 也没有 compaction，升它既没内容可升，改了还要多写一次库。
 */
export const upgradeSession = (record: Session): UpgradeResult => {
  const from = readVersion(record)
  if (from !== undefined && from > CONTENT_VERSION) {
    // 比本程序新：原样交出去。只读展示仍然可用，至少不会因为格式更新而丢数据。
    return { session: record, fromFuture: true }
  }
  if (from === CONTENT_VERSION) {
    return { session: record, fromFuture: false }
  }
  let session = record
  let version = from ?? 0
  while (version < CONTENT_VERSION) {
    const migrate = MIGRATIONS[version]
    if (!migrate) {
      return { session, fromFuture: false }
    }
    session = migrate(session)
    version += 1
  }
  // 走到这里说明已经升到当前版本：打上版本号，下次读就不用再迁移。
  return { session: { ...session, schema: version }, fromFuture: false }
}
