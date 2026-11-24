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
     * 打开系统的"后台/自启动管理"页。
     *
     * 各家自建的页面组件名随版本变，所以按候选列表逐个试：先用 PackageManager 解析能不能
     * 找到这个 Activity，找不到就下一个；startActivity 抛异常（华为部分 HarmonyOS 机型会
     * 直接抛 ActivityNotFound）也只当作"这一个不行"，继续下一个。全部失败就退回
     * 「应用信息」页——那一页所有安卓机都有。
     *
     * 调用方传进来的是网页侧判定的厂商类别（huawei / xiaomi / oppo / vivo / other），
     * 原生侧不重复做厂商判断。
     */
    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        String guide = call.getString("guide", "other");
        boolean opened = false;
        for (String[] candidate : candidatesFor(guide)) {
            if (tryOpenComponent(candidate[0], candidate[1])) {
                opened = true;
                break;
            }
        }
        if (!opened) {
            opened = tryOpenComponent(null, null);
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    /**
     * 只有华为/荣耀给候选组件：它们的「应用启动管理」是一个全局列表页，从「应用信息」进不去。
     *
     * 其它厂商一律直接落到「应用信息」——实测小米的 `PowerDetailActivity`（电量详情）虽然能被
     * 解析到，但缺了系统内部才会传的 extra，启动后立刻自己关掉，用户看到的是闪一下又回到原处，
     * 比老实打开应用信息更糟。宁可少跳一步，也不要跳到一个会自己消失的页面。
     */
    private String[][] candidatesFor(String guide) {
        if ("huawei".equals(guide)) {
            return new String[][] {
                {"com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity"},
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            };
        }
        return new String[0][];
    }

    /** 组件为空时打开本应用的「应用信息」页；任何异常都只返回 false */
    private boolean tryOpenComponent(String packageName, String className) {
        try {
            Intent intent = new Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (packageName == null || className == null) {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent.setComponent(new ComponentName(packageName, className));
                // 先解析再启动：不存在就安静地试下一个，不指望异常来兜底
                if (getContext().getPackageManager().resolveActivity(intent, 0) == null) {
                    return false;
                }
            }
            getContext().startActivity(intent);
            return true;
        } catch (Exception error) {
            Log.w(TAG, "open failed: " + packageName + "/" + className + " " + error);
            return false;
        }
    }
}
