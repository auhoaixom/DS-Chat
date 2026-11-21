import type { TranslationKey } from '../../i18n/index.js'
import { formatDate } from '../../utils/format.js'
import { setBackupProgress, shouldReportProgress } from '../backupProgress.js'
import { shareBlob } from '../exportFile.js'
import * as db from './db.js'
import { BackupError } from './history/errors.js'
import { replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError }

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    setBackupProgress({ job: 'export', stage: 'reading', done: 0, total: null })
    async function* readSessions(): AsyncGenerator<Session> {
      // 崩溃兜底页可能在 initChat 之前导出，此时内存清单还是空的，直接按数据库列一遍
      const list = sessions.length > 0 ? sessions : await db.loadSessionSummaries()
      const total = list.length
      let done = 0
      setBackupProgress({ job: 'export', stage: 'reading', done, total })
      for (const summary of list) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        done += 1
        if (shouldReportProgress(done, done === total)) {
          setBackupProgress({ job: 'export', stage: 'reading', done, total })
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
      // 会话读完了，剩下的是打包与写缓存文件：这部分算不出条数，但必须让界面知道还在动
      setBackupProgress({ job: 'export', stage: 'writing', done: null, total: null })
    }
    try {
      const { exportArchive } = await import('./history/exportArchive.js')
      const now = new Date()
      const blob = await exportArchive(readSessions())
      return { name: backupFileName(now), blob }
    } catch (error) {
      // 失败就把进度收掉；成功时由 exportToShare 负责，它还要写缓存再弹分享面板
      setBackupProgress(null)
      throw error
    }
  })

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    setBackupProgress({ job: 'import', stage: 'reading', done: 0, total: null })
    try {
      await checkArchiveFormat(file)
      const count = await replaceHistory(() =>
        importArchive(file, (done, final) => {
          if (final) {
            // 读完了，接下来是替换本地数据：把最终条数报出来，别停在 1230
            setBackupProgress({ job: 'import', stage: 'writing', done, total: done })
          } else if (shouldReportProgress(done, false)) {
            setBackupProgress({ job: 'import', stage: 'reading', done, total: null })
          }
        }),
      )
      return count
    } finally {
      setBackupProgress(null)
    }
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })

/** 导出失败的原因：可预期的失败带文案 key，其余带原始信息 */
export type ExportFailure = { key: TranslationKey } | { message: string }

/**
 * 导出全部会话并交给系统分享面板。设置页、「保存失败」横幅和崩溃兜底页共用这一条路径，
 * 失败只返回原因，由调用方决定是弹 toast、写在行内还是留在页面上。
 */
export const exportToShare = async (): Promise<ExportFailure | null> => {
  try {
    const { name, blob } = await exportHistory()
    await shareBlob(blob, name, (written, total) => {
      setBackupProgress({ job: 'export', stage: 'writing', done: written, total, unit: 'bytes' })
    })
    return null
  } catch (error) {
    return error instanceof BackupError
      ? { key: error.key }
      : { message: error instanceof Error ? error.message : String(error) }
  } finally {
    setBackupProgress(null)
  }
}
