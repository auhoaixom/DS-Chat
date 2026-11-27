import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { finishCrop, isCropping } from '../components/camera/cropState.js'
import { finishInAppCamera, isInAppCameraOpen } from '../components/camera/inAppCameraState.js'
import { closeAttachPanel, isAttachPanelOpen } from '../components/chatInput/attachPanelState.js'
import { useFilePreview } from '../components/files/filePreviewState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { backToRoot, closeSettings, settingsBackAction, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { closeRightSider, useRightSider } from '../components/turns/rightSiderState.js'
import { newChat, useChatStore } from '../services/chat/store.js'

/**
 * 安卓返回键：按界面层级逐级后退，最后才退出应用。
 * 顺序为 设置弹窗 → 搜索面板 → 移动端侧栏 → 当前会话 → 退出。
 * 浏览器中不注册，返回空解绑函数。
 */
export const bindBackButton = () => {
  if (!Capacitor.isNativePlatform()) {
    return () => {}
  }
  const handle = CapacitorApp.addListener('backButton', () => {
    // 裁剪界面在最上层，返回键等于取消裁剪
    if (isCropping()) {
      finishCrop(null)
      return
    }
    // 自建相机在裁剪之下、其余之上，返回键等于放弃拍照
    if (isInAppCameraOpen()) {
      finishInAppCamera(null)
      return
    }
    // 附件面板等同于键盘，返回键先收它
    if (isAttachPanelOpen()) {
      closeAttachPanel()
      return
    }
    // 图片预览在其次，优先关闭
    if (useFilePreview.getState().url) {
      useFilePreview.getState().close()
      return
    }
    if (useSettingsDialog.getState().open) {
      // 设置是两层的：在子页先退回分类列表，已经在列表才关窗
      if (settingsBackAction() === 'section') {
        backToRoot()
      } else {
        closeSettings()
      }
      return
    }
    if (useSearchPanel.getState().entry !== null) {
      closeSearchPanel()
      return
    }
    if (useMobileSider.getState().open) {
      closeMobileSider()
      return
    }
    if (useRightSider.getState().open) {
      closeRightSider()
      return
    }
    if (useChatStore.getState().activeId !== null) {
      newChat()
      return
    }
    void CapacitorApp.exitApp()
  })
  return () => {
    void handle.then((listener) => listener.remove())
  }
}
