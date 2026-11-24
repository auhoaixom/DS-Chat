package com.dschat.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 直接设置状态栏 / 导航栏底色与图标明暗。
 *
 * 两件事决定了必须自己来：
 * 1. Capacitor 的 status-bar 插件在 Android 16（API 36）设备上会跳过 setBackgroundColor
 *    （见 StatusBar.java 的 shouldSetStatusBarColor），只剩 setStyle 生效。
 * 2. 窗口带 LAYOUT_FULLSCREEN + 透明系统栏配色，所以状态栏区域显示的是**窗口背景**
 *    （AppCompat 浅色主题下的 #FAFAFA）。只调 setStatusBarColor 在 API 36 上不生效，
 *    必须同时把窗口背景刷成主题色，否则深色模式下就是浅底 + 浅字。
 *
 * 这套设置会被系统**重置**：进出小窗、小窗切全屏、分屏、画中画都会重新装饰窗口，
 * 底色退回主题的 windowBackground，图标明暗也一起归零。前端只会在"主题变化"时调一次，
 * 所以那之后就是浅底浅字——状态栏时间和图标直接隐身。为此这里记住最后一次设定，
 * 由 MainActivity 在窗口状态变化的回调里重放（见 {@link #reapply}）。
 */
@CapacitorPlugin(name = "SystemBar")
public class SystemBarPlugin extends Plugin {

    private static final String TAG = "DSChatSystemBar";

    /** 存界面偏好用的 SharedPreferences（与加密那套 ds-chat-secure 分开） */
    private static final String PREFS = "ds-chat-ui";
    private static final String KEY_THEME = "theme";

    /** 最后一次生效的设定；窗口被重新装饰后用它重放 */
    private static Integer lastColor = null;
    private static boolean lastLightIcons = true;

    @PluginMethod
    public void setStatusBarColor(PluginCall call) {
        String color = call.getString("color", "#000000");
        boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", true));

        int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException error) {
            call.reject("invalid color: " + color);
            return;
        }

        lastColor = parsed;
        lastLightIcons = lightIcons;

        getActivity()
            .runOnUiThread(() -> {
                apply(getActivity().getWindow(), parsed, lightIcons);
                Log.i(TAG, "status bar " + color + " lightIcons=" + lightIcons);
            });
        call.resolve();
    }

    /**
     * 记下应用内选的深浅色，给**下一次启动**的启动画面用。
     * 前端的选择原本只存在 WebView 的 localStorage 里，原生读不到，启动时就只能跟着系统走，
     * 于是「应用深色 + 系统浅色」会先闪一屏浅色。存一份到 SharedPreferences 才能对上。
     */
    @PluginMethod
    public void setAppTheme(PluginCall call) {
        String theme = call.getString("theme", "");
        if (!"dark".equals(theme) && !"light".equals(theme)) {
            call.reject("invalid theme: " + theme);
            return;
        }
        getContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, theme)
            .apply();
        call.resolve();
    }

    /** 读上次存下的深浅色；没存过（首次启动）返回 null，由调用方跟随系统 */
    public static String savedTheme(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_THEME, null);
    }

    /**
     * 窗口状态变了（小窗 / 分屏 / 画中画 / 全屏互切）之后，按最后一次设定重新刷一遍。
     * 前端不知道这些变化，也不会因此再调一次插件，所以只能由原生自己补。
     */
    public static void reapply(Activity activity) {        Integer color = lastColor;
        if (activity == null || color == null) {
            return;
        }
        boolean lightIcons = lastLightIcons;
        activity.runOnUiThread(() -> apply(activity.getWindow(), color, lightIcons));
    }

    static void apply(Window window, int color, boolean lightIcons) {
        // setStatusBarColor 需要这两个 flag 才会被系统采用
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);

        // 系统栏当前是透明的，看到的是窗口背景：一起刷成同色
        View decor = window.getDecorView();
        decor.setBackgroundColor(color);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        // lightIcons=false 表示深色图标（浅色底），与浅色主题一致
        controller.setAppearanceLightStatusBars(!lightIcons);
        controller.setAppearanceLightNavigationBars(!lightIcons);
    }
}
