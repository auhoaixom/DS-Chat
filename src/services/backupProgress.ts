import { create } from 'zustand'

/**
 * 导入 / 导出的进行状态。设置页的两行就是靠它显示「还在动」的。
 *
 * 条数能给就给（导出总数一开始就知道；导入要读完 index 才知道，所以只有已完成的条数），
 * 给不出来就只给阶段，界面照样能说清在干什么 —— 别让用户对着一颗不动的灰按钮等 37 秒。
 */
export type BackupProgress = {
  job: 'export' | 'import'
  /** reading：逐条读会话 / 解压；writing：打包、写缓存文件或替换本地数据 */
  stage: 'reading' | 'writing'
  done: number | null
  total: number | null
  /** done/total 的单位：条数，或写缓存文件时的字节数（默认条数） */
  unit?: 'sessions' | 'bytes'
} | null

export const useBackupProgress = create<{ value: BackupProgress }>(() => ({ value: null }))

export const setBackupProgress = (value: BackupProgress) => {
  useBackupProgress.setState({ value })
}

/** 每处理这么多条才刷新一次界面：一两千条逐条 setState 会把设置页刷爆 */
export const PROGRESS_STEP = 10

/**
 * 要不要把这一条报给界面。
 *
 * `final` 必须在收尾时置真：只按「每 10 条取模」的话，1239 条的最后一次会停在
 * 1230（1239 % 10 = 9），用户永远看不到真实总数 —— v0.9.20 就是这么错的。
 */
export const shouldReportProgress = (done: number, final: boolean) =>
  final || done % PROGRESS_STEP === 0

/**
 * 读完最后一条之后，界面先停在「已读 N / N」再切到「正在替换本地数据…」。
 * 这几百毫秒是留给人眼看见解压走到底的 —— 直接跳阶段的话数字永远停在最后一个整十数。
 */
export const WRITING_PHASE_DELAY_MS = 350
