import { countSessions } from './chat/db.js'
import { initChat } from './chat/store.js'
import { getDataKey } from './crypto/keySource.js'
import {
  needsEncryption,
  runEncryptionMigration,
  useEncMigration,
} from './crypto/migration.js'
import { unlockApiKey } from './settings.js'

/**
 * 启动顺序。
 *
 * 顺序本身是要求的一部分：
 * 1. 先拿到数据密钥——后面所有解密都依赖它，拿不到就什么都不该显示；
 * 2. 再把库里的明文记录加密掉（没有会话时是空操作）；
 * 3. 再解锁 API Key；
 * 4. 最后才读会话列表。
 *
 * 步骤 2 在旧库上要花几秒，期间界面盖遮罩、不接受任何操作——
 * 迁移和用户操作并发是这里唯一真正会损坏数据的情形，所以直接不允许发生。
 */

let booting: Promise<void> | null = null

const finishBoot = async (): Promise<void> => {
  await unlockApiKey()
  await initChat()
  useEncMigration.setState({ booted: true })
}

const start = async (): Promise<void> => {
  await getDataKey()
  if (await needsEncryption()) {
    const total = await countSessions()
    if (total > 0) {
      // 有东西要加密：先停下来问一句，让用户有机会导备份。
      useEncMigration.setState({ phase: 'notice', done: 0, total, failed: [], error: null })
      return
    }
    // 空库：没有任何明文需要处理，直接打标记，别让新装用户看见一个"正在加密"的框。
    await runEncryptionMigration()
  }
  await finishBoot()
}

export const boot = (): Promise<void> =>
  (booting ??= start().catch((error: unknown) => {
    booting = null
    useEncMigration.setState({
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }))

/** 用户点了「继续」之后跑迁移，跑完接着完成启动 */
export const confirmEncryption = async (): Promise<void> => {
  const { setState } = useEncMigration
  setState({ phase: 'running', done: 0, total: 0, failed: [] })
  const { failed, total } = await runEncryptionMigration((done, count) =>
    setState({ done, total: count })
  )
  if (failed.length > 0) {
    setState({ phase: 'failed', failed })
    return
  }
  setState({ phase: 'done', done: total, total })
  await finishBoot()
}

/** 供测试重置：boot 只跑一次，用例之间要能重来 */
export const resetBootForTest = () => {
  booting = null
  useEncMigration.setState({
    phase: 'idle',
    done: 0,
    total: 0,
    failed: [],
    error: null,
    booted: false,
  })
}
