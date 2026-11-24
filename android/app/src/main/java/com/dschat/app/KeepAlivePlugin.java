package com.dschat.app;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
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
     * 厂商名，用来决定"到应用信息里该找哪一项"的提示文案。
     *
     * 只跳应用信息页（所有安卓机都有），按厂商变的只是那句话：华为是「应用启动管理」，
     * 小米是「省电策略」……各家自建的后台开关既读不到状态、也跳不过去，
     * 所以这里只提供判断依据，不做任何跳转尝试。
     */
    @PluginMethod
    public void getVendor(PluginCall call) {
        JSObject result = new JSObject();
        result.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        call.resolve(result);
    }

    /**
     * 打开系统的「应用信息」页——所有安卓机都有，实测每台都能到。
     *
     * 曾经按厂商试过跳「应用启动管理」之类的页面（华为四个候选、小米电量详情等），结论是：
     * 小米那个缺系统 extra，启动后立刻自己关掉；华为四个候选在真机上全部落空（最后退回的就是
     * 这一页）。既然都到不了，就不要再绕：只跳应用信息，具体找哪一项交给弹窗里那段文案。
     *
     * 参数 guide 保留但不再使用：文案仍然按厂商给，将来若真拿到实机验证过的组件名，
     * 在这里按 guide 分流即可，网页侧不用改。
     */
    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        boolean opened = false;
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
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }
}
