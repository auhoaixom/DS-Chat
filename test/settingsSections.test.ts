import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  backToRoot,
  closeSettings,
  ensureApiKey,
  openSection,
  openSettings,
  SETTINGS_SECTIONS,
  settingsBackAction,
  useSettingsDialog,
} from '../src/components/settings/settingsDialogState.js'
import { setApiKey } from '../src/services/settings.js'

/**
 * 分类的顺序是用户定的，不是代码顺手排的。
 * 顺序一变，他每天点的那几下滑动路径就全变了——这种改动必须有人签字，
 * 所以用测试钉住，改的时候至少会看见这行断言。
 */
test('六个分类按用户定的顺序排', () => {
  assert.deepEqual(SETTINGS_SECTIONS, [
    'account',
    'data',
    'region',
    'personalization',
    'chat',
    'about',
  ])
})

test('关于也是子页：进去之后返回是退一格', () => {
  openSettings()
  openSection('about')
  assert.equal(settingsBackAction(), 'section')
  backToRoot()
  assert.equal(settingsBackAction(), 'close')
})

/**
 * 设置的两层页面：返回键该退一格还是关窗，全看这个状态。
 *
 * 顺序错了用户就会在子页里被一次按出设置——手机上很显眼，
 * 又很难在截图里看出来，所以用测试钉住。
 */
test('侧边栏点设置落在分类列表', () => {
  openSettings()
  const state = useSettingsDialog.getState()
  assert.equal(state.open, true)
  assert.equal(state.section, null)
})

test('在子页时返回是退一格，在列表时返回是关窗', () => {
  openSection('chat')
  assert.equal(useSettingsDialog.getState().section, 'chat')
  assert.equal(settingsBackAction(), 'section')

  backToRoot()
  assert.equal(useSettingsDialog.getState().section, null)
  assert.equal(settingsBackAction(), 'close')
})

test('关窗把页面归零，下次打开不会停在旧子页', () => {
  openSection('data')
  closeSettings()
  assert.equal(useSettingsDialog.getState().open, false)
  assert.equal(useSettingsDialog.getState().section, null)

  openSettings()
  assert.equal(useSettingsDialog.getState().section, null)
})

test('没有 API Key 时直接落在账户子页', () => {
  setApiKey(null)
  assert.equal(ensureApiKey(), false)
  const state = useSettingsDialog.getState()
  assert.equal(state.open, true)
  assert.equal(state.section, 'account')
})

test('已有 API Key 时不去打扰用户', () => {
  closeSettings()
  setApiKey('sk-test-value')
  assert.equal(ensureApiKey(), true)
  assert.equal(useSettingsDialog.getState().open, false)
  setApiKey(null)
})
