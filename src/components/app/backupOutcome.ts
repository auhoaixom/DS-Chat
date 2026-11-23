import type { ExportFailure } from '../../services/chat/backup.js'

/** 备份按钮的四种状态 */
export type BackupState = 'idle' | 'busy' | 'done' | 'error'

/**
 * 导出结束之后，备份按钮该显示什么。
 *
 * 「用户取消」必须回到 idle，不能显示「备份已生成」：文件根本没被交出去，
 * 用户会以为存好了，然后放心加密、放心重装，最后才发现没有备份。
 * 这一条在真机上抓到的——点了导出、在系统分享面板上按 ✕，界面照样亮出绿字。
 */
export const nextBackupState = (failure: ExportFailure | null): BackupState =>
  failure === null ? 'done' : 'canceled' in failure ? 'idle' : 'error'
