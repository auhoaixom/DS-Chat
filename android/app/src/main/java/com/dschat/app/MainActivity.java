package com.dschat.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Collections;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DSChatSplash";
    /** 从系统返回手势里让出来的左边缘宽度（dp），比网页手势的起手区窄，只贴物理边缘 */
    private static final int EDGE_SWIPE_WIDTH_DP = 24;
    /** 网页还没完成首次布局时重试几次，取到高度再上报排除区 */
    private static final int EDGE_SWIPE_RETRIES = 5;
    /** 与 theme.css 的 --dsw-alias-bg-base 保持一致：启动画面的底色必须和网页底色是同一个值 */
    private static final int DARK_BG = 0xFF151517;
    private static final int LIGHT_BG = 0xFFFFFFFF;
    /** 启动画面里字标宽度占屏幕宽度的比例（与 tools/icon/build-icons.py 的 0.46 一致） */
    private static final float SPLASH_LOGO_RATIO = 0.46f;
    /**
     * 看门狗：只在网页永远不回报「可以显示了」时兜底（JS 抛错、渲染进程挂了），
     * 免得一直卡在 logo 上。正常路径不看时间，撤掉完全由网页的信号决定。
     */
    private static final long SPLASH_WATCHDOG_MS = 10_000;

    /** 当前实例，供 SplashPlugin 转调 */
    private static MainActivity current;

    private View splashOverlay;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 启动画面按**应用里选的**深浅色二选一（见 styles.xml 的 SplashLight / SplashDark）。
        // 必须赶在 super.onCreate 之前换主题：窗口是按当前主题建好的，之后再 setTheme 就晚了。
        setTheme(isDarkTheme() ? R.style.AppTheme_SplashDark : R.style.AppTheme_SplashLight);
        registerPlugin(SystemBarPlugin.class);
        registerPlugin(ClipboardPlugin.class);
        registerPlugin(RecentPhotosPlugin.class);
        registerPlugin(SecureKeyPlugin.class);
        registerPlugin(KeepAlivePlugin.class);
        registerPlugin(SplashPlugin.class);
        super.onCreate(savedInstanceState);
        current = this;
        showSplash(isDarkTheme());
        surviveRendererDeath();
    }

    @Override
    public void onDestroy() {
        if (current == this) {
            current = null;
        }
        super.onDestroy();
    }

    /** 网页说「可以显示了」时由 SplashPlugin 调用；重复调用无害 */
    static void dismissSplashNow() {
        MainActivity activity = current;
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(activity::hideSplash);
    }

    /**
     * 应用内的深浅色：优先用前端上一次存下的选择（SystemBarPlugin 的 setAppTheme），
     * 没存过（第一次装）就跟随系统。
     */
    private boolean isDarkTheme() {
        String saved = SystemBarPlugin.savedTheme(this);
        if (saved != null) {
            return "dark".equals(saved);
        }
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /**
     * 启动画面：底色 + 居中字标，盖在网页上面，等页面画出来再撤掉。
     *
     * 为什么必须自己画一层：安卓 12 起系统的启动画面由平台绘制，颜色我们改不了
     * （实测改窗口底色、改 windowSplashScreenBackground 都不生效，小米用的是壁纸色），
     * 而且页面画出来之后它就消失了 —— 光靠窗口背景根本看不到字标（实测连一帧都没有）。
     *
     * 同时把 WebView 的底色调成透明：页面还没绘制时露出的是同色窗口背景，不是白色。
     */
    private void showSplash(boolean dark) {
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
        }
        // 挂到 decor 上而不是 android.R.id.content：content 在状态栏/导航栏之下，
        // 挂那儿会在黑底上面留一条白边（小米实测）。挂 decor 就是整屏覆盖。
        ViewGroup root = (ViewGroup) getWindow().getDecorView();
        if (root == null) {
            return;
        }
        // Capacitor 的 BridgeActivity.onCreate 会把自己主题换回 AppTheme.NoActionBar
        // （android:background=@null），窗口底色因此变成默认的浅色 —— 状态栏/导航栏那两条
        // 就是这么白出来的。这里显式给窗口上一次色，整屏（含两条系统栏）才是同一个底色。
        getWindow().setBackgroundDrawable(new ColorDrawable(dark ? DARK_BG : LIGHT_BG));

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(dark ? DARK_BG : LIGHT_BG);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        int width = Math.round(getResources().getDisplayMetrics().widthPixels * SPLASH_LOGO_RATIO);
        overlay.addView(
            logo,
            new FrameLayout.LayoutParams(width, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        );

        root.addView(
            overlay,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        splashOverlay = overlay;
        Log.i(TAG, "splash shown at " + System.currentTimeMillis());
        SystemBarPlugin.apply(getWindow(), dark ? DARK_BG : LIGHT_BG, dark);
        // 再补一次：Capacitor 启动时会用自己的默认值刷一遍状态栏（浅色），
        // 那一下会把我们上面设的颜色盖掉，于是启动画面顶部留下一条白边。
        overlay.postDelayed(
            () -> SystemBarPlugin.apply(getWindow(), dark ? DARK_BG : LIGHT_BG, dark),
            220
        );
        // 看门狗：网页永远不回报时兜底，避免卡在 logo 上
        overlay.postDelayed(this::hideSplash, SPLASH_WATCHDOG_MS);
    }

    /**
     * 撤掉启动画面。由网页的信号触发（时机 = 会话列表读完 / 弹出加密对话框 / 出现错误页），
     * 原生这边没有任何计时器；重复调用无害。
     */
    private void hideSplash() {
        final View overlay = splashOverlay;
        if (overlay == null) {
            return;
        }
        splashOverlay = null;
        Log.i(TAG, "splash dismissed at " + System.currentTimeMillis());
        ViewGroup parent = (ViewGroup) overlay.getParent();
        if (parent != null) {
            parent.removeView(overlay);
        }
        getWindow().getDecorView().setBackgroundColor(isDarkTheme() ? DARK_BG : LIGHT_BG);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
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
