import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { openBytes, sealBytes } from '../crypto/seal.js'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/**
 * IndexedDB 存储结构版本；新增或调整存储、索引时递增。
 *
 * 12：新增 `meta` 存储，用来记本地数据加密的迁移进度。
 * 加密本身不是靠升级回调完成的——`upgrade` 必须同步跑完，
 * 而 WebCrypto 是异步的，在里面 await 会让升级事务提前自动提交。
 * 所以升级只建存储，真正的加密迁移在打开连接之后单独跑（见 crypto/migration.ts）。
 */
const DB_VERSION = 12

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

/**
 * 加密后的会话记录。**明文部分只有索引和排序用得上的字段**：
 * id、时间、置顶、引用到的文件 id。
 *
 * 拆成 meta / body 两个载荷是关键设计：
 * - 重命名、改标题只碰 meta（几十字节），不必把几 MB 的 messages 读进来再加密；
 * - body 只在打开会话、写回会话时动。
 * 两段各用各的附加数据（`id#meta` / `id#body`），互相不能顶替。
 */
export type SealedSummary = {
  id: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
  fileIds: string[]
  /** 解密后为 { title } */
  meta: ArrayBuffer
}

export type SealedSession = SealedSummary & {
  /** 解密后为 { messages, rootMessageId, compaction, schema } */
  body: ArrayBuffer
}

/** meta 载荷解密后的内容 */
type SealedMeta = { title: string }

/** body 载荷解密后的内容；undefined 的字段不写进 JSON，读回来自然还是 undefined */
type SealedBody = Pick<
  Session,
  'messages' | 'rootMessageId' | 'compaction' | 'schema' | 'anchorId' | 'extraCosts'
>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 附加数据：把 meta 挪到 body、或把 A 会话的密文挪到 B 会话，解密都会失败 */
const aadOf = (id: string, part: 'meta' | 'body') => `${id}#${part}`

const json = (value: unknown) => encoder.encode(JSON.stringify(value))

export const isSealedSession = (value: unknown): value is SealedSession =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'meta' in value

/** 摘要与会话用的是同一个判断：有 `meta` 就是加密过 */
export const isSealedSummary = (value: unknown): value is SealedSummary =>
  isSealedSession(value)

const pickBody = (session: Session): SealedBody => ({
  messages: session.messages,
  rootMessageId: session.rootMessageId,
  compaction: session.compaction,
  schema: session.schema,
  // 撤销压缩后挂上的锚点必须落盘，否则杀掉 App 重开就退回那个偏低的数
  anchorId: session.anchorId,
  // 压缩摘要那几笔请求的钱只存在会话上，丢了会话合计就少一截
  extraCosts: session.extraCosts,
})

const sealMeta = (id: string, title: string): Promise<ArrayBuffer> =>
  sealBytes(json({ title } satisfies SealedMeta), aadOf(id, 'meta'))

const openMeta = async (sealed: { id: string; meta: ArrayBuffer }): Promise<SealedMeta> =>
  JSON.parse(decoder.decode(await openBytes(sealed.meta, aadOf(sealed.id, 'meta')))) as SealedMeta

/** 明文会话 → 加密记录。`fileIds` 由调用方给出，导入与正常保存的来源不同。 */
export const sealSession = async (session: Session, fileIds: string[]): Promise<SealedSession> => ({
  id: session.id,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  ...(session.pinned === undefined ? {} : { pinned: session.pinned }),
  fileIds,
  meta: await sealMeta(session.id, session.title),
  body: await sealBytes(json(pickBody(session)), aadOf(session.id, 'body')),
})

export const openSession = async (sealed: SealedSession): Promise<Session> => {
  const [meta, body] = await Promise.all([
    openMeta(sealed),
    openBytes(sealed.body, aadOf(sealed.id, 'body')).then(
      (plain) => JSON.parse(decoder.decode(plain)) as SealedBody
    ),
  ])
  return {
    id: sealed.id,
    title: meta.title,
    createdAt: sealed.createdAt,
    updatedAt: sealed.updatedAt,
    messages: body.messages,
    ...(body.rootMessageId === undefined ? {} : { rootMessageId: body.rootMessageId }),
    ...(body.compaction === undefined ? {} : { compaction: body.compaction }),
    ...(sealed.pinned === undefined ? {} : { pinned: sealed.pinned }),
    ...(body.schema === undefined ? {} : { schema: body.schema }),
    ...(body.anchorId === undefined ? {} : { anchorId: body.anchorId }),
    ...(body.extraCosts === undefined ? {} : { extraCosts: body.extraCosts }),
  }
}

/** 摘要与同 id 会话的 meta 是同一份内容：密文不同（随机 nonce），解出来一致 */
export const sealSummary = async (summary: StoredSessionSummary): Promise<SealedSummary> => ({
  id: summary.id,
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
  ...(summary.pinned === undefined ? {} : { pinned: summary.pinned }),
  fileIds: summary.fileIds,
  meta: await sealMeta(summary.id, summary.title),
})

export const openSummary = async (sealed: SealedSummary): Promise<SessionSummary> => {
  const meta = await openMeta(sealed)
  return {
    id: sealed.id,
    title: meta.title,
    createdAt: sealed.createdAt,
    updatedAt: sealed.updatedAt,
    ...(sealed.pinned === undefined ? {} : { pinned: sealed.pinned }),
  }
}

/** 从会话记录里切出摘要记录：body 不要，meta 原样搬过去，不解密 */
const summaryOf = (sealed: SealedSession): SealedSummary => ({
  id: sealed.id,
  createdAt: sealed.createdAt,
  updatedAt: sealed.updatedAt,
  ...(sealed.pinned === undefined ? {} : { pinned: sealed.pinned }),
  fileIds: sealed.fileIds,
  meta: sealed.meta,
})

interface ChatDB extends DBSchema {
  /**
   * 当前使用的会话，界面读写都在这里。
   * 迁移期间可能还留着明文记录，所以类型是联��：读到什么形状就是什么，不做假设。
   */
  sessions: { key: string; value: SealedSession | Session }
  sessionSummaries: {
    key: string
    value: SealedSummary | StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件；**不加密**，附件字节保持原样 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   * 暂存里写进去的已经是加密记录，所以替换那一步是纯搬运、零加解密。
   */
  sessionsStaging: { key: string; value: SealedSession | Session }
  filesStaging: { key: string; value: StoredFile }
  /** 迁移进度等零散标记；不加索引 */
  meta: { key: string; value: { key: string; value: unknown } }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

/**
 * 正在被删除的会话。
 *
 * 加密是异步的：`saveSession` / `renameSession` 在开写事务之前要 await 一次 `crypto.subtle`，
 * 那几毫秒里同一条会话完全可能已经被删掉了。没有这个集合的话，
 * 加密完成后照旧写回去，表现就是「刚删掉的对话自己回来了」——删除只是被延后，并没有生效。
 *
 * 所以删除期间开始的读写一律放弃。被放弃的那份内容，本来也正是这次删除要丢掉的。
 */
const removing = new Set<string>()

/**
 * 列表元数据：只带标题、时间、置顶与引用到的文件 id。
 * **不含 messages，也不含 compaction** —— 列表靠它渲染，打开会话时才读完整记录。
 */
export const toStoredSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const storedSummary = toStoredSummary

/**
 * 重命名 / 置顶都要**整条读出、只改一个字段、原样写回**。
 * 单独抽出来是为了让"别用摘要重建会话"这条约束落到代码里：
 * 摘要是列表元数据，缺 messages 与 compaction，照它重建就等于把会话洗空。
 */
export const withTitle = (session: Session, title: string): Session => ({ ...session, title })

export const withPinned = (session: Session, pinned: boolean): Session => {
  const next = { ...session }
  if (pinned) {
    next.pinned = true
  } else {
    delete next.pinned
  }
  return next
}

/** 置顶只改明文区，因此不需要解密、也不需要重新加密 meta */
const withSealedPinned = (sealed: SealedSession, pinned: boolean): SealedSession => {
  const next = { ...sealed }
  if (pinned) {
    next.pinned = true
  } else {
    delete next.pinned
  }
  return next
}

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> => {
  const records = await (await getDB()).getAll('sessionSummaries')
  // 并行解密：一条摘要是几十字节，几百条加起来也只有几十毫秒。
  // 迁移期间可能读到还没加密的旧记录，那种直接当明文用。
  return Promise.all(
    records.map((record): Promise<SessionSummary> =>
      isSealedSummary(record) ? openSummary(record) : Promise.resolve(record)
    )
  )
}

export const loadSession = async (id: string): Promise<Session | undefined> => {
  const record = await (await getDB()).get('sessions', id)
  if (!record) {
    return undefined
  }
  return isSealedSession(record) ? openSession(record) : record
}

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  // 加密全部在事务之前做完：事务里一旦 await 非 IDB 的 Promise（crypto.subtle 就是），
  // IndexedDB 会立刻把它提交掉，后面的 put 直接抛 TransactionInactiveError。
  const sealed = await sealSession(session, summary.fileIds)
  const sealedSummary = summaryOf(sealed)
  if (removing.has(session.id)) {
    return
  }
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(sealed)
        await tx.objectStore('sessionSummaries').put(sealedSummary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/**
 * 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。
 *
 * 标题在 meta 载荷里，所以这里**不需要解密 body**：读一条记录、重新封一次 meta、
 * 在一个事务里写回会话与摘要。改几 MB 会话的标题不该吃几 MB 的 CPU。
 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const record = await (await getDB()).get('sessions', id)
  if (!record) {
    return
  }
  if (!isSealedSession(record)) {
    // 迁移之前留下的明文记录：走整条读改写，顺便把它加密掉。
    await saveSession(withTitle(record, title))
    return
  }
  const meta = await sealMeta(id, title)
  const next = { ...record, meta }
  if (removing.has(id)) {
    return
  }
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessions').put(next),
    tx.objectStore('sessionSummaries').put(summaryOf(next)),
    tx.done,
  ])
}

/** 未打开的会话也可置顶；置顶在明文区，不改密文，事务保持原子 */
export const setSessionPinned = async (id: string, pinned: boolean): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const record = await sessions.get(id)
        if (!record) {
          return
        }
        if (!isSealedSession(record)) {
          const next = withPinned(record, pinned)
          await sessions.put(next)
          await tx.objectStore('sessionSummaries').put(storedSummary(next))
          return
        }
        const next = withSealedPinned(record, pinned)
        await sessions.put(next)
        await tx.objectStore('sessionSummaries').put(summaryOf(next))
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  // 从这一刻起，任何还在加密途中的保存都放弃写回（见 `removing` 的说明）
  removing.add(sessionId)
  try {
    const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
    await Promise.all([
      (async () => {
        try {
          const summaries = tx.objectStore('sessionSummaries')
          const summary = await summaries.get(sessionId)
          await tx.objectStore('sessions').delete(sessionId)
          await summaries.delete(sessionId)
          // fileIds 在明文区，删附件原件不需要解密任何东西
          for (const id of summary?.fileIds ?? []) {
            if ((await summaries.index('fileIds').count(id)) === 0) {
              await tx.objectStore('files').delete(id)
            }
          }
        } catch (error) {
          abortTransaction(tx)
          throw error
        }
      })(),
      tx.done,
    ])
  } finally {
    removing.delete(sessionId)
  }
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

/**
 * 导入时逐条写入暂存。这里就加密，所以后面整批替换是纯搬运、不碰 CPU：
 * 既保住了 `commitStaging` 的低内存（同时只有一条在内存里），也不会在替换事务里 await 加密。
 */
export const addStagingSession = async (session: Session): Promise<void> => {
  const sealed = await sealSession(session, storedSummary(session).fileIds)
  await (await getDB()).add('sessionsStaging', sealed)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/**
 * 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。
 *
 * 加密后不能"边读边改边写"：改一条要解密、加密，中间不能夹在事务里。
 * 所以分批三轮——读一批、在事务外改一批、再写一批。回填本身幂等，中断重跑没有副作用。
 */
const STAGING_MIME_BATCH = 40

export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const db = await getDB()
  let lastId: string | undefined
  for (;;) {
    const read = db.transaction('sessionsStaging', 'readonly')
    const batch: (SealedSession | Session)[] = []
    let cursor = await read.store.openCursor(lastId === undefined ? null : IDBKeyRange.lowerBound(lastId, true))
    while (cursor && batch.length < STAGING_MIME_BATCH) {
      batch.push(cursor.value)
      lastId = cursor.value.id
      cursor = await cursor.continue()
    }
    await read.done
    if (batch.length === 0) {
      return
    }

    // 事务外：该解密的解密、改完重新加密
    const updated: SealedSession[] = []
    for (const record of batch) {
      const session = isSealedSession(record) ? await openSession(record) : record
      let changed = false
      for (const message of session.messages) {
        if (message.role !== 'user') {
          continue
        }
        for (const file of message.files) {
          const type = types.get(file.id) ?? ''
          if (file.mimeType !== type) {
            file.mimeType = type
            changed = true
          }
        }
      }
      if (changed) {
        const fileIds = isSealedSession(record) ? record.fileIds : storedSummary(record).fileIds
        updated.push(await sealSession(session, fileIds))
      }
    }

    if (updated.length > 0) {
      const write = db.transaction('sessionsStaging', 'readwrite')
      await Promise.all([...updated.map((record) => write.store.put(record)), write.done])
    }

    if (batch.length < STAGING_MIME_BATCH) {
      return
    }
  }
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 *
 * 暂存里已经是加密记录，这里只把 `body` 摘掉当摘要写过去，**一次加解密都不做**，
 * 所以整个替换仍然是单个事务、仍然原子。摘要的标题在事务结束后才解。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const sealedSummaries: SealedSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      await target.clear()
      if (to === 'sessions') {
        await tx.objectStore('sessionSummaries').clear()
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const record = cursor.value as SealedSession | Session
          if (isSealedSession(record)) {
            const summary = summaryOf(record)
            await tx.objectStore('sessionSummaries').put(summary)
            sealedSummaries.push(summary)
          } else {
            // 只有加密机制之前写入的暂存才可能走到这里：那种情况下摘要不带 meta，
            // 交给最后那一步统一处理（会当场加密一次）。
            const summary = storedSummary(record)
            await tx.objectStore('sessionSummaries').put(summary)
          }
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])

  // 事务已经结束，现在解摘要的标题是安全的。
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  const summaries = await Promise.all(sealedSummaries.map(openSummary))
  if (summaries.length > 0) {
    return summaries
  }
  return loadSessionSummaries()
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}

/**
 * 零散标记的读写（迁移进度等）。
 * 单独一个存储而不是塞进 localStorage：这些标记描述的是库本身的状态，
 * 跟库一起被清、一起被备份才对。
 */
export const readMeta = async <T>(key: string): Promise<T | undefined> =>
  (await (await getDB()).get('meta', key))?.value as T | undefined

export const writeMeta = async (key: string, value: unknown): Promise<void> => {
  await (await getDB()).put('meta', { key, value })
}

/**
 * 按前缀读一批 meta（附件价格这类成片的小记录）。
 * 返回 `[key, value]`，键按存储顺序，不做排序；调用方自己剥前缀。
 */
export const readMetaEntries = async (prefix: string): Promise<Array<[string, unknown]>> => {
  const db = await getDB()
  const read = db.transaction('meta', 'readonly')
  const entries: Array<[string, unknown]> = []
  try {
    let cursor = await read.store.openCursor()
    while (cursor) {
      const key = String(cursor.key)
      if (key.startsWith(prefix)) {
        entries.push([key, (cursor.value as { value?: unknown }).value])
      }
      cursor = await cursor.continue()
    }
  } finally {
    await read.done
  }
  return entries
}

export const countSessions = async (): Promise<number> => (await getDB()).count('sessions')

/** 迁移的分批大小：一批一条游标事务，内存里同时最多这么多条会话 */
const MIGRATION_BATCH = 40

/** 逐批扫一个存储，`handle` 返回要写回的记录；空批即到头 */
const scanBatches = async <T extends { id: string }>(
  store: 'sessions' | 'sessionSummaries',
  handle: (batch: T[]) => Promise<void>
): Promise<void> => {
  const db = await getDB()
  let lastId: string | undefined
  for (;;) {
    const read = db.transaction(store, 'readonly')
    const batch: T[] = []
    let cursor = await read.store.openCursor(
      lastId === undefined ? null : IDBKeyRange.lowerBound(lastId, true)
    )
    while (cursor && batch.length < MIGRATION_BATCH) {
      batch.push(cursor.value as unknown as T)
      lastId = cursor.value.id
      cursor = await cursor.continue()
    }
    await read.done
    if (batch.length === 0) {
      return
    }
    await handle(batch)
    if (batch.length < MIGRATION_BATCH) {
      return
    }
  }
}

/**
 * 把库里的明文记录就地加密（一次性迁移）。
 *
 * 三条性质是这个函数的设计目标：
 * - **幂等**：靠记录形状判断（有 `meta` 就是加密过），不记游标，中断重跑只是跳过已加密的；
 * - **不删原记录**：写回是同 id 覆盖，中途失败也只是那条还是明文，不会消失；
 * - **单条不阻塞整体**：一条失败记进 `failed`，其余继续，调用方据此决定要不要打完成标记。
 *
 * 每批三步——读一批、事务外加密一批、一个短事务写回一批。中间那步必须离开事务，
 * 否则 `crypto.subtle` 的 await 会把事务提前提交掉。
 */
export const sealAllSessions = async (
  onProgress?: (done: number, total: number) => void
): Promise<{ sealed: number; failed: string[] }> => {
  const db = await getDB()
  const total = await db.count('sessions')
  const failed: string[] = []
  let sealed = 0
  let done = 0
  onProgress?.(0, total)

  await scanBatches<SealedSession | Session>('sessions', async (batch) => {
    const writes: SealedSession[] = []
    for (const record of batch) {
      if (isSealedSession(record)) {
        continue
      }
      try {
        const summary = storedSummary(record)
        writes.push(await sealSession(record, summary.fileIds))
        sealed += 1
      } catch (error) {
        failed.push(record.id)
        reportStorageError(`encrypt session ${record.id}`)(error)
      }
    }
    if (writes.length > 0) {
      const write = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
      await Promise.all([
        ...writes.map((record) => write.objectStore('sessions').put(record)),
        ...writes.map((record) => write.objectStore('sessionSummaries').put(summaryOf(record))),
        write.done,
      ])
    }
    done += batch.length
    onProgress?.(done, total)
  })

  // 再单独扫摘要：老库里可能存在只有摘要、没有详情的记录，上面那一轮碰不到它们。
  await scanBatches<SealedSummary | StoredSessionSummary>('sessionSummaries', async (batch) => {
    const writes: SealedSummary[] = []
    for (const record of batch) {
      if (isSealedSummary(record)) {
        continue
      }
      try {
        writes.push(await sealSummary(record))
      } catch (error) {
        failed.push(record.id)
        reportStorageError(`encrypt summary ${record.id}`)(error)
      }
    }
    if (writes.length > 0) {
      const write = db.transaction('sessionSummaries', 'readwrite')
      await Promise.all([...writes.map((record) => write.store.put(record)), write.done])
    }
  })

  return { sealed, failed }
}

