package com.dschat.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 直接写系统剪贴板。
 *
 * 网页侧的 navigator.clipboard.writeText 要求文档处于聚焦状态且有用户激活，
 * execCommand('copy') 也依赖 DOM 焦点：部分机型（如华为）长按公式时会先弹出系统选区栏，
 * 焦点被抢走，两次尝试都失败，于是「复制失败」隔次出现。
 * 从原生侧调 setPrimaryClip 不依赖 WebView 焦点，能绕开这一整类问题。
 */
@CapacitorPlugin(name = "NativeClipboard")
public class ClipboardPlugin extends Plugin {

    private static final String TAG = "DSChatClipboard";

    @PluginMethod
    public void write(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("text is required");
            return;
        }
        ClipboardManager manager =
                (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager == null) {
            call.reject("clipboard service unavailable");
            return;
        }
        try {
            manager.setPrimaryClip(ClipData.newPlainText("DS Chat", text));
            Log.i(TAG, "copied " + text.length() + " chars");
            call.resolve();
        } catch (Exception error) {
            Log.w(TAG, "copy failed: " + error.getMessage());
            call.reject("clipboard write failed: " + error.getMessage());
        }
    }
}
