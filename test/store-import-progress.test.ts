import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initChat } from '../src/services/chat/store.js'
import { importHistory } from '../src/services/chat/backup.js'
import { exportArchive } from '../src/services/chat/history/exportArchive.js'
import { useBackupProgress, type BackupProgress } from '../src/services/backupProgress.js'
import type { Session } from '../src/services/chat/types.js'
import { userMessage } from './helpers.js'

const waitFor = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`等不到：${label}`)
}

const makeSession = (index: number): Session => ({
  id: `s${index}`,
  title: `对话 ${index}`,
  createdAt: index,
  updatedAt: index,
  messages: [userMessage(`内容 ${index}`, `s${index}-m1`)],
})

/**
 * 导入的进度必须真的走到底。
 *
 * 之前节流按「每 10 条取模」，1239 条的最后一次刷新落在 1230，解压阶段永远显示不满；
 * 收尾时又直接跳到「正在替换本地数据…」，用户看到的是「解压停在一半就换阶段了」。
 *
 * 这里用真实 ZIP 跑完整流程（无网络），断言解压阶段的最后一个数字等于总数。
 */
test('导入：解压阶段要走到总数，再切到替换阶段', async () => {
  await initChat()

  // 23 条：故意不是 10 的整数倍，能复现「最后停在 20」那个坑
  const sessions = Array.from({ length: 23 }, (_, index) => makeSession(index))
  const blob = await exportArchive(sessions)
  const file = new File([await blob.arrayBuffer()], 'history.zip', { type: 'application/zip' })

  const seen: BackupProgress[] = []
  const unsubscribe = useBackupProgress.subscribe((state) => {
    if (state.value) {
      seen.push(state.value)
    }
  })

  try {
    const count = await importHistory(file)
    assert.equal(count, 23)

    // 「替换阶段」是读完 350ms 后才切过去的标签：导入够快时整个流程已经结束，它不会出现。
    // 这里不做「必须出现」的断言 —— 那条会变成绑死实现，而且小包本来就不该闪一下标签。
    await waitFor(() => useBackupProgress.getState().value === null, '进度已清理')
  } finally {
    unsubscribe()
  }

  const reading = seen.filter((progress) => progress?.stage === 'reading')
  const last = reading.at(-1)
  assert.ok(last, '一条解压进度都没报')
  assert.equal(last.done, 23, `解压阶段停在 ${last.done}，没有走到总数`)
  assert.equal(last.total, 23)

  // 如果出现了替换阶段，它必须排在「已读满」之后
  const writingIndex = seen.findIndex((progress) => progress?.stage === 'writing')
  if (writingIndex !== -1) {
    assert.ok(
      writingIndex > seen.lastIndexOf(last),
      '替换阶段抢在「已读满」前面了',
    )
  }
})
