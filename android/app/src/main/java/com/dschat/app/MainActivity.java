package com.dschat.app;

import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

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
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        excludeEdgeSwipe(EDGE_SWIPE_RETRIES);
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
