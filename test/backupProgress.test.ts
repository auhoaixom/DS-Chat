import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROGRESS_STEP, shouldReportProgress } from '../src/services/backupProgress.js'

test('节流：每 PROGRESS_STEP 条报一次', () => {
  assert.equal(shouldReportProgress(PROGRESS_STEP, false), true)
  assert.equal(shouldReportProgress(PROGRESS_STEP * 3, false), true)
  assert.equal(shouldReportProgress(PROGRESS_STEP + 1, false), false)
})

test('收尾必须报：1239 条不会停在 1230', () => {
  // 1239 % 10 = 9，只按取模的话最后一次刷新落在 1230，用户永远看不到真实总数
  assert.equal(shouldReportProgress(1239, false), false)
  assert.equal(shouldReportProgress(1239, true), true)
  // 正好整除时也不能漏
  assert.equal(shouldReportProgress(1240, true), true)
})

test('只有 1 条也必须报', () => {
  assert.equal(shouldReportProgress(1, true), true)
})
