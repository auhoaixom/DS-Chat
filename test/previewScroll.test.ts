import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PREVIEW_FOLLOW,
  PREVIEW_SNAP_RATIO,
  nextOffset,
} from '../src/components/messages/previewScroll.js'

/**
 * 这一组钉的是小窗的"连续跟随"，不是"按行跳变"。
 *
 * v1.1.0 之前我按整行裁剪设计过一版，那是错的：官方的效果是每帧追一点、慢半拍，
 * 所以边缘会切在字中间。这里守住的就是那三条：单调、不过冲、追平即停。
 */

test('朝目标单调推进，且每一帧都在 current 与 target 之间（不过冲）', () => {
  const target = 100
  let offset = 0
  let first = 0
  let frames = 0
  while (offset < target && frames < 200) {
    const next = nextOffset({ current: offset, target, windowHeight: 120 })
    assert.ok(next >= offset, '必须单调上升')
    assert.ok(next <= target, '不能越过目标')
    if (frames === 0) {
      first = next
    }
    offset = next
    frames += 1
  }
  assert.equal(offset, target, '最终必须精确落在目标上')
  // 100px 的差距在 0.2 的追速下大约 20 帧内收敛，绝不该出现几百帧的情况
  assert.ok(frames < 40, `收敛太慢：${frames} 帧`)
  // 第一帧不能一步到位：那说明退化成"跳变"了
  assert.ok(first > 0 && first < target, `首帧应只走一部分，实际 ${first}`)
})

test('每帧只走剩下的这一份比例；连续两帧的步长必须递减（缓入非跳变）', () => {
  const target = 60
  const first = nextOffset({ current: 0, target, windowHeight: 120 })
  const second = nextOffset({ current: first, target, windowHeight: 120 })
  assert.equal(first, target * PREVIEW_FOLLOW)
  assert.ok(second - first < first, '第二步必须比第一步小，否则不是缓入')
})

test('离目标不到 1px 就吸附到目标，不再残留小数', () => {
  const next = nextOffset({ current: 99.6, target: 100, windowHeight: 120 })
  assert.equal(next, 100)
})

test('落后超过 3 个窗口高时直接跳过去，不做长追赶', () => {
  const windowHeight = 120
  const target = windowHeight * (PREVIEW_SNAP_RATIO + 1)
  const next = nextOffset({ current: 0, target, windowHeight })
  assert.equal(next, target, '一次进来一大段内容时应当直接贴底')
})

test('系统要求减少动效时一步到位', () => {
  const next = nextOffset({ current: 0, target: 50, windowHeight: 120, reducedMotion: true })
  assert.equal(next, 50)
})
