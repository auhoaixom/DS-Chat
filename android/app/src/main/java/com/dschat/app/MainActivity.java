package com.dschat.app;

import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Collections;

public class MainActivity extends BridgeActivity {
    /** 从系统返回手势里让出来的左边缘宽度（dp），比网页手势的起手区窄，只贴物理边缘 */
    private static final int EDGE_SWIPE_WIDTH_DP = 24;
    /** 网页还没完成首次布局时重试几次，取到高度再上报排除区 */
    private static final int EDGE_SWIPE_RETRIES = 5;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemBarPlugin.class);
        registerPlugin(ClipboardPlugin.class);
        registerPlugin(RecentPhotosPlugin.class);
        registerPlugin(SecureKeyPlugin.class);
        super.onCreate(savedInstanceState);
        surviveRendererDeath();
    }

    /**
     * 渲染进程被系统回收时，别让整个应用跟着死。
     *
     * 安卓把 WebView 的渲染进程和宿主进程分开管理，内存吃紧时系统会直接回收渲染进程。
     * 默认行为是把宿主 Activity 一起判死（用户看到的是"应用闪退"），其实页面只是需要重载一次。
     * 接管这个回调、返回 true 表示"我处理了"，然后重新加载页面即可。
     */
    private void surviveRendererDeath() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    webView.post(webView::reload);
                    return true;
                }
            }
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        excludeEdgeSwipe(EDGE_SWIPE_RETRIES);
        // 从后台、小窗或分屏回来时，系统可能已经重新装饰过窗口
        SystemBarPlugin.reapply(this);
    }

    /**
     * 窗口模式或尺寸变化后，系统会把状态栏底色与图标明暗重置回主题默认值。
     * 深色模式下那就是浅底浅字（时间直接看不见），这里按上次的设定重放一遍。
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        SystemBarPlugin.reapply(this);
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode, Configuration newConfig) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig);
        SystemBarPlugin.reapply(this);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        SystemBarPlugin.reapply(this);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            SystemBarPlugin.reapply(this);
        }
    }

    /**
     * 安卓 10 起手势导航会先吃掉左边缘横滑（当成返回），这条手势就会退出应用。
     * 把左边缘这一段从系统返回手势里排除掉，交回给网页里的右滑开侧边栏。
     */
    private void excludeEdgeSwipe(int retries) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return;
        }
        Bridge bridge = getBridge();
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.post(() -> {
            int height = webView.getHeight();
            if (height <= 0) {
                // 首帧还没量出高度，稍后再试，避免上报一个零高度的排除区
                if (retries > 0) {
                    webView.postDelayed(() -> excludeEdgeSwipe(retries - 1), 300);
                }
                return;
            }
            int width =
                Math.round(EDGE_SWIPE_WIDTH_DP * getResources().getDisplayMetrics().density);
            // 整高上报，系统自己按「每条边缘最多 200dp」裁剪：实测这台机器只保留屏底
            // 200dp 那一段（1190~1590），中段和上段都会被系统收回给返回手势。
            webView.setSystemGestureExclusionRects(
                Collections.singletonList(new Rect(0, 0, width, height))
            );
        });
    }
}
