import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextBackupState } from '../src/components/app/backupOutcome.js'

/**
 * 备份按钮的状态映射。
 *
 * 这一条是**真机上抓到的**：点「导出备份」→ 系统分享面板弹出 → 按 ✕ 取消 →
 * 盖在上面的引导框亮出绿字「备份已生成。」。文件其实还在缓存目录里没交出去，
 * 用户会以为存好了，然后放心加密、放心重装，最后发现没有备份。
 */
test('导出结果映射到按钮状态：取消回到未备份，只有失败才报错', () => {
  assert.equal(nextBackupState(null), 'done')
  assert.equal(nextBackupState({ message: 'boom' }), 'error')
  // 取消既不是成功也不是失败：必须回到「还没备份」的样子
  assert.equal(nextBackupState({ canceled: true }), 'idle')
})
