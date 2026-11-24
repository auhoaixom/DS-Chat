package com.dschat.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
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
     * 是否已获得"忽略电池优化"（MIUI 里就是「省电策略 = 无限制」）。
     *
     * 息屏那条路上系统和厂商的冻结策略比前台服务更强势：实测前台服务 + 唤醒锁都挡不住
     * `reason = screen off` 的冻结，只有这条豁免能救。所以设置里要能显示当前状态。
     */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        boolean ignoring = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager power =
                        (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                ignoring =
                        power != null
                                && power.isIgnoringBatteryOptimizations(
                                        getContext().getPackageName());
            } else {
                ignoring = true;
            }
        } catch (Exception error) {
            Log.w(TAG, "isIgnoringBatteryOptimizations failed: " + error);
        }
        JSObject result = new JSObject();
        result.put("ignoring", ignoring);
        call.resolve(result);
    }

    /**
     * 拉起系统/厂商的"允许后台运行"设置。
     *
     * 先请求标准的电池优化豁免弹窗；被系统拒绝（部分 ROM 不允许直接弹）就退回应用信息页，
     * 那里能看到 MIUI 的「省电策略」。两条都失败也只是没跳转，不影响任何功能。
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        boolean opened = false;
        try {
            String pkg = getContext().getPackageName();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent request =
                        new Intent(
                                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                        Uri.parse("package:" + pkg))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(request);
                opened = true;
            }
        } catch (Exception error) {
            Log.w(TAG, "requestIgnoreBatteryOptimizations failed: " + error);
        }
        if (!opened) {
            try {
                Intent details =
                        new Intent(
                                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.parse("package:" + getContext().getPackageName()))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(details);
                opened = true;
            } catch (Exception error) {
                Log.w(TAG, "open app settings failed: " + error);
            }
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }
}
