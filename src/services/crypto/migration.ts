import { create } from 'zustand'
import { countSessions, readMeta, sealAllSessions, writeMeta } from '../chat/db.js'

/**
 * 本地数据加密的迁移状态机。
 *
 * 只有一件事需要协调：库里已有明文会话时，先让用户看一眼提示、导一次备份，
 * 再动数据。没有会话时整段是空操作——新装用户不该被任何东西打扰。
 */

const STATE_KEY = 'enc-state'

export type EncState = {
  version: 1
  /** 会话正文、标题、压缩摘要已加密 */
  sessionsEnc: boolean
  /**
   * 附件字节已加密。**本次发布恒为 false**——附件不加密。
   * 留着这一位是因为将来扩到附件时，只需要把它翻成 true、只跑附件那一段，
   * 不用重扫一遍已经加密好的会话。
   */
  filesEnc: boolean
}

const EMPTY_STATE: EncState = { version: 1, sessionsEnc: false, filesEnc: false }

/** 迁移的界面阶段；notice 与 running 期间界面被遮罩挡住，不接任何操作 */
export type EncPhase = 'idle' | 'notice' | 'running' | 'done' | 'failed'

export const useEncMigration = create<{
  phase: EncPhase
  done: number
  total: number
  failed: string[]
  error: string | null
  /** 启动流程是否已经走完（迁移 + 解锁 + 读列表）；界面据此决定能否开始正常交互 */
  booted: boolean
}>(() => ({ phase: 'idle', done: 0, total: 0, failed: [], error: null, booted: false }))

export const readEncState = async (): Promise<EncState> => {
  const saved = await readMeta<EncState>(STATE_KEY)
  if (saved?.version !== 1) {
    return EMPTY_STATE
  }
  return { ...EMPTY_STATE, ...saved }
}

/** 库里还有没加密的记录时返回 true */
export const needsEncryption = async (): Promise<boolean> => !(await readEncState()).sessionsEnc

/**
 * 跑一次迁移。
 *
 * 幂等：已加密的记录按形状跳过，所以中途被杀、下次启动重跑都安全。
 * 有任意一条失败就**不打完成标记**，让下次启动重试；失败的那条此刻仍是明文，
 * 数据本身没有丢。
 */
export const runEncryptionMigration = async (
  onProgress?: (done: number, total: number) => void
): Promise<{ failed: string[]; total: number }> => {
  const state = await readEncState()
  if (state.sessionsEnc) {
    return { failed: [], total: 0 }
  }
  const total = await countSessions()
  const { failed } = await sealAllSessions(onProgress)
  if (failed.length === 0) {
    await writeMeta(STATE_KEY, { ...state, sessionsEnc: true })
  }
  return { failed, total }
}
