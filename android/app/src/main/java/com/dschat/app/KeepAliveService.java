package com.dschat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 生成期间的前台服务：让进程别被系统当成缓存进程冻结。
 *
 * 为什么要它：应用切到后台就变成缓存进程，Android 12 起系统会冻结这类进程（HyperOS 更激进），
 * CPU 调度停掉、JS 不再执行，网页侧的流式读取跟着停。用户切回来看到的要么是断流报错，
 * 要么是"后台这段时间白等了"。前台服务把进程提升到"用户可感知"级别，冻结就不会发生，
 * 网页里的流式循环（它对 document.hidden 已经做了同步刷新的处理）照常跑完。
 *
 * 通知是 Android 的硬规定（前台服务必须可见）。文案由网页侧按当前界面语言传下来，
 * 这里不写死任何文字。
 *
 * 唤醒锁用来覆盖"锁屏/息屏"这一种同样常见的场景：那时候就算进程没被冻结，
 * CPU 也会进睡眠，流式读取一样会停。
 */
public class KeepAliveService extends Service {
    static final String TAG = "DSChatKeepAlive";
    static final String CHANNEL_ID = "ds-chat-generating";
    static final int NOTIFICATION_ID = 1001;
    static final String ACTION_START = "com.dschat.app.action.KEEPALIVE_START";
    static final String ACTION_STOP = "com.dschat.app.action.KEEPALIVE_STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    /** 唤醒锁上限：异常路径下（页面崩了、服务没收到 stop）不至于把电池耗干 */
    private static final long WAKE_LOCK_TIMEOUT_MS = 10 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopKeepAlive();
            return START_NOT_STICKY;
        }
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String body = intent == null ? null : intent.getStringExtra(EXTRA_BODY);
        startForegroundCompat(buildNotification(this, title, body));
        acquireWakeLock();
        // 进程被杀不要自己爬起来：生成是网页侧驱动的，服务单独活着没有意义
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopKeepAlive() {
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            return;
        }
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power == null) {
            return;
        }
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DSChat::generating");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    /** 通知本体；插件更新进度时也调它，保证两处样式一致 */
    static Notification buildNotification(Context context, String title, String body) {
        ensureChannel(context);
        Intent open =
                new Intent(context, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending =
                PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title == null ? "" : title)
                .setContentText(body == null ? "" : body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(pending)
                .build();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel =
                new NotificationChannel(CHANNEL_ID, "generating", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
        Log.i(TAG, "notification channel created");
    }
}
