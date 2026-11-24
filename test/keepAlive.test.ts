import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  acquireKeepAlive,
  keepAliveCountForTest,
  openBackgroundSettings,
  readVendorGuide,
  releaseKeepAlive,
  reportKeepAliveProgress,
  setKeepAliveBridgeForTest,
  setKeepAliveNativeForTest,
  vendorGuideFor,
} from '../src/services/keepAlive.js'

/**
 * 保活开关的三条纪律：引用计数、永不抛错、非原生平台 no-op。
 *
 * 这三条都是"出事时不能连累发消息"的护栏，而它们平时看不见 ——
 * 真机上只会表现为"通知栏多一条/少一条"，所以要用单测钉住。
 */
const makeBridge = () => {
  const calls = { start: 0, stop: 0, progress: [] as number[] }
  return {
    calls,
    bridge: {
      start: async () => {
        calls.start += 1
        return { started: true }
      },
      progress: async (options: { title: string; body: string }) => {
        const digits = /\d+/.exec(options.body)
        calls.progress.push(digits ? Number(digits[0]) : -1)
      },
      stop: async () => {
        calls.stop += 1
      },
      getVendor: async () => ({ manufacturer: 'Xiaomi' }),
      openBackgroundSettings: async () => ({ opened: true }),
    },
  }
}

beforeEach(() => {
  setKeepAliveBridgeForTest(null)
  setKeepAliveNativeForTest(null)
})

test('两条流同时生成时，只在第一条起服务，最后一条结束才停', async () => {
  const { calls, bridge } = makeBridge()
  setKeepAliveBridgeForTest(bridge)
  setKeepAliveNativeForTest(true)

  await acquireKeepAlive()
  await acquireKeepAlive()
  assert.equal(calls.start, 1, '第二条流不该再起一次服务')
  assert.equal(keepAliveCountForTest(), 2)

  await releaseKeepAlive()
  assert.equal(calls.stop, 0, '还有一条流在跑，不能停服务')

  await releaseKeepAlive()
  assert.equal(calls.stop, 1, '最后一条流结束才停')
  assert.equal(keepAliveCountForTest(), 0)
})

test('起服务失败也不能抛错，发消息不依赖保活', async () => {
  let stopped = 0
  setKeepAliveBridgeForTest({
    start: async () => {
      throw new Error('service refused')
    },
    progress: async () => {},
    stop: async () => {
      stopped += 1
    },
    getVendor: async () => ({ manufacturer: '' }),
    openBackgroundSettings: async () => ({ opened: true }),
  })
  setKeepAliveNativeForTest(true)

  await acquireKeepAlive()
  assert.equal(keepAliveCountForTest(), 1, '起不来也要把计数记上，否则 release 会配不上')

  await releaseKeepAlive()
  assert.equal(stopped, 1)
})

test('停止失败同样吞掉，不影响已经结束的回复', async () => {
  setKeepAliveBridgeForTest({
    start: async () => ({ started: true }),
    progress: async () => {},
    stop: async () => {
      throw new Error('stop failed')
    },
    getVendor: async () => ({ manufacturer: '' }),
    openBackgroundSettings: async () => ({ opened: true }),
  })
  setKeepAliveNativeForTest(true)

  await acquireKeepAlive()
  await releaseKeepAlive()
  assert.equal(keepAliveCountForTest(), 0)
})

test('非原生平台（浏览器/探针/单测）完全不碰桥', async () => {
  const { calls, bridge } = makeBridge()
  setKeepAliveBridgeForTest(bridge)
  setKeepAliveNativeForTest(false)

  await acquireKeepAlive()
  reportKeepAliveProgress(120)
  await releaseKeepAlive()

  assert.deepEqual(calls, { start: 0, stop: 0, progress: [] })
})

test('进度两秒内只上报一次，且上报的是最新字数', async () => {
  const originalNow = Date.now
  let clock = 1_000_000
  Date.now = () => clock
  try {
    const { calls, bridge } = makeBridge()
    setKeepAliveBridgeForTest(bridge)
    setKeepAliveNativeForTest(true)
    await acquireKeepAlive()

    reportKeepAliveProgress(40)
    reportKeepAliveProgress(80)
    assert.deepEqual(calls.progress, [40], '两秒内的第二次不该再发')

    clock += 2100
    reportKeepAliveProgress(160)
    assert.deepEqual(calls.progress, [40, 160])
  } finally {
    Date.now = originalNow
  }
})

test('没有流在跑时不上报进度（避免通知里出现幽灵进度）', async () => {
  const { calls, bridge } = makeBridge()
  setKeepAliveBridgeForTest(bridge)
  setKeepAliveNativeForTest(true)

  reportKeepAliveProgress(99)
  assert.deepEqual(calls.progress, [])
})

/**
 * 提示框里指路的那句话靠厂商名选：华为是「应用启动管理」，小米是「省电策略」……
 * 认错厂商只会让那句话指错地方，所以映射要钉住，并且大小写、别名都要认。
 */
test('厂商名映射到对应的指路文案', () => {
  assert.equal(vendorGuideFor('HUAWEI'), 'huawei')
  assert.equal(vendorGuideFor('HONOR'), 'huawei', '荣耀和华为同一套设置')
  assert.equal(vendorGuideFor('Hihonor'), 'huawei')
  assert.equal(vendorGuideFor('Xiaomi'), 'xiaomi')
  assert.equal(vendorGuideFor('Redmi'), 'xiaomi')
  assert.equal(vendorGuideFor('POCO'), 'xiaomi')
  assert.equal(vendorGuideFor('OPPO'), 'oppo')
  assert.equal(vendorGuideFor('realme'), 'oppo')
  assert.equal(vendorGuideFor('OnePlus'), 'oppo')
  assert.equal(vendorGuideFor('vivo'), 'vivo')
  assert.equal(vendorGuideFor('iQOO'), 'vivo')
  assert.equal(vendorGuideFor('samsung'), 'other', '认不出来的走通用说法')
  assert.equal(vendorGuideFor(''), 'other')
  assert.equal(vendorGuideFor(null), 'other')
})

test('读厂商名失败时按"认不出"处理，不抛错', async () => {
  setKeepAliveBridgeForTest({
    start: async () => ({ started: true }),
    progress: async () => {},
    stop: async () => {},
    getVendor: async () => {
      throw new Error('boom')
    },
    openBackgroundSettings: async () => ({ opened: true }),
  })
  setKeepAliveNativeForTest(true)

  assert.equal(await readVendorGuide(), 'other')
})

test('非原生平台不读厂商、也不跳系统页面', async () => {
  let opened = 0
  let vendor = 0
  setKeepAliveBridgeForTest({
    start: async () => ({ started: true }),
    progress: async () => {},
    stop: async () => {},
    getVendor: async () => {
      vendor += 1
      return { manufacturer: 'HUAWEI' }
    },
    openBackgroundSettings: async () => {
      opened += 1
      return { opened: true }
    },
  })
  setKeepAliveNativeForTest(false)

  assert.equal(await readVendorGuide(), 'other', '浏览器里没有厂商这个概念')
  await openBackgroundSettings('other')
  assert.equal(vendor, 0)
  assert.equal(opened, 0)
})
