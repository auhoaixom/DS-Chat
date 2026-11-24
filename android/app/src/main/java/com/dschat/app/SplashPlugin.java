package com.dschat.app;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 网页说「我这儿可以显示了」，就把启动画面撤掉。
 *
 * 时机由网页决定（会话列表读完 / 出现加密对话框 / 出现错误页），原生这边不看时间，
 * 只认这一个信号；万一网页永远不回报，MainActivity 里的看门狗会兜底。
 */
@CapacitorPlugin(name = "Splash")
public class SplashPlugin extends Plugin {

    private static final String TAG = "DSChatSplash";

    @PluginMethod
    public void dismiss(PluginCall call) {
        long fromWeb = call.getLong("at", 0L);
        long now = System.currentTimeMillis();
        Log.i(TAG, "web reported ready at " + fromWeb + ", native got it at " + now + " (+" + (now - fromWeb) + "ms)");
        MainActivity.dismissSplashNow();
        call.resolve();
    }
}
