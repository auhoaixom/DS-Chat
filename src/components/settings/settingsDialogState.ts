import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'

/** 设置的六个分类，值同时是子页的身份 */
export type SettingsSection =
  | 'account'
  | 'data'
  | 'region'
  | 'personalization'
  | 'chat'
  | 'about'

/**
 * 分类在列表里的顺序。
 * 用户定的顺序：账户 → 数据 → 语言与地区 → 个性化 → 聊天与后台 → 关于。
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  'account',
  'data',
  'region',
  'personalization',
  'chat',
  'about',
]

/**
 * 设置弹窗是两层的：
 * `section === null` 是分类列表，其余值表示停在该分类的子页上。
 * 侧边栏「设置」按钮一律从列表开始；没有 API Key 这类入口才直接落在子页。
 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: null as SettingsSection | null,
}))

export const openSettings = (section: SettingsSection | null = null) =>
  useSettingsDialog.setState({ open: true, section })

export const openSection = (section: SettingsSection) => useSettingsDialog.setState({ section })

export const backToRoot = () => useSettingsDialog.setState({ section: null })

/**
 * 关窗同时把页面归零，下次打开一定从分类列表开始。
 * 顺带收起侧边栏：设置是从侧边栏点进来的，关掉之后还留着抽屉在那儿
 * 看着像没关干净（多半还是从「设置」那一行退出来）。
 */
export const closeSettings = () => {
  closeMobileSider()
  useSettingsDialog.setState({ open: false, section: null })
}

/**
 * 返回键 / 返回箭头该做什么：在子页就回列表，已经在列表就关窗。
 * 单独抽成纯函数，好让测试直接守着这条层级顺序。
 */
export const settingsBackAction = (): 'section' | 'close' =>
  useSettingsDialog.getState().section === null ? 'close' : 'section'

/** 没有 API Key 时打开设置并选中它所在的「账户」子页，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('account')
  return false
}
