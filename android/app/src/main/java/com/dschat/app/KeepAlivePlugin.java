package com.dschat.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 网页侧控制保活服务的桥。
 *
 * 三个方法**永不 reject**：保活是加分项，起不来也绝不能影响发消息。
 * 网页侧因此只需按普通 Promise 用，"这次没有保活"就是全部后果。
 *
 * stop 用 stopService 而不是 startService(ACTION_STOP)：流结束时应用可能正在后台，
 * 而从后台启动服务在 Android 8+ 会被拒绝；stopService 不受这个限制。
 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {
    private static final String TAG = "DSChatKeepAlive";

    @PluginMethod
    public void start(PluginCall call) {
        boolean started = false;
        try {
            Intent intent =
                    new Intent(getContext(), KeepAliveService.class)
                            .setAction(KeepAliveService.ACTION_START)
                            .putExtra(KeepAliveService.EXTRA_TITLE, call.getString("title", ""))
                            .putExtra(KeepAliveService.EXTRA_BODY, call.getString("body", ""));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            started = true;
        } catch (Exception error) {
            // 后台启动限制、系统拒绝等：都只是"这次没有保活"
            Log.w(TAG, "start failed: " + error);
        }
        JSObject result = new JSObject();
        result.put("started", started);
        call.resolve(result);
    }

    @PluginMethod
    public void progress(PluginCall call) {
        try {
            NotificationManager manager =
                    (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(
                        KeepAliveService.NOTIFICATION_ID,
                        KeepAliveService.buildNotification(
                                getContext(),
                                call.getString("title", ""),
                                call.getString("body", "")));
            }
        } catch (Exception error) {
            Log.w(TAG, "progress failed: " + error);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        } catch (Exception error) {
            Log.w(TAG, "stop failed: " + error);
        }
        call.resolve();
    }

    /**
     * 打开系统「设置」首页——所有安卓机都有，不会失效。
     *
     * 之前按厂商猜过具体的后台管理页（小米的电量详情、华为的启动管理四个候选、vivo 的后台
     * 高耗电），真机上全部失败：要么缺系统内部 extra 启动后自己关掉，要么根本不存在。
     * 我们没有那么多台机器去逐个验证，所以一刀切：只送到设置入口，
     * 具体往哪翻由弹窗里那句通用文案告诉用户。
     */
    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        boolean opened = false;
        try {
            Intent intent =
                    new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            opened = true;
        } catch (Exception error) {
            Log.w(TAG, "openSystemSettings failed: " + error);
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }
}
