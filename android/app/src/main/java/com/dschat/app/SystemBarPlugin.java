package com.dschat.app;

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
 */
@CapacitorPlugin(name = "SystemBar")
public class SystemBarPlugin extends Plugin {

    private static final String TAG = "DSChatSystemBar";

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

        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            // setStatusBarColor 需要这两个 flag 才会被系统采用
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.setStatusBarColor(parsed);
            window.setNavigationBarColor(parsed);

            // 系统栏当前是透明的，看到的是窗口背景：一起刷成同色
            View decor = window.getDecorView();
            decor.setBackgroundColor(parsed);

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            // lightIcons=false 表示深色图标（浅色底），与浅色主题一致
            controller.setAppearanceLightStatusBars(!lightIcons);
            controller.setAppearanceLightNavigationBars(!lightIcons);
            Log.i(TAG, "status bar " + color + " lightIcons=" + lightIcons);
        });
        call.resolve();
    }
}
