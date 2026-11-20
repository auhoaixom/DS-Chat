package com.dschat.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Size;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 读取系统相册里最近的图片，供附件面板的「最近照片」条使用。
 *
 * 只读不写：缩略图与用户点选的原图都先落到应用缓存目录，再由网页侧经
 * Capacitor.convertFileSrc 转成可访问的 URL。权限按系统版本分三档：
 * Android 14+ 允许「选择部分照片」（limited），13 用 READ_MEDIA_IMAGES，
 * 更早的系统用 READ_EXTERNAL_STORAGE。
 */
@CapacitorPlugin(name = "RecentPhotos")
public class RecentPhotosPlugin extends Plugin {

    private static final String TAG = "DSChatPhotos";
    private static final int REQUEST_CODE = 7301;

    private static final String PERMISSION_PARTIAL = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED";

    private PluginCall pendingCall;

    /** 当前授权状态：none / limited（仅选中若干张）/ full */
    @PluginMethod
    public void check(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", accessState());
        call.resolve(result);
    }

    /** 请求相册权限；已有授权时直接返回当前状态 */
    @PluginMethod
    public void request(PluginCall call) {
        if (!"none".equals(accessState())) {
            resolveState(call);
            return;
        }
        pendingCall = call;
        getActivity().requestPermissions(requiredPermissions(), REQUEST_CODE);
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQUEST_CODE || pendingCall == null) {
            return;
        }
        PluginCall call = pendingCall;
        pendingCall = null;
        resolveState(call);
    }

    /** 最近的图片列表，缩略图已转成缓存文件路径 */
    @PluginMethod
    public void list(final PluginCall call) {
        if ("none".equals(accessState())) {
            call.reject("denied");
            return;
        }
        final int limit = call.getInt("limit", 18);
        // 查询与缩略图解码都是 IO，放到后台线程，避免卡住界面
        new Thread(
            () -> {
                JSArray photos = new JSArray();
                ContentResolver resolver = getContext().getContentResolver();
                Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                };
                String order = MediaStore.Images.Media.DATE_ADDED + " DESC";
                try (Cursor cursor = resolver.query(collection, projection, null, null, order)) {
                    while (cursor != null && cursor.moveToNext() && photos.length() < limit) {
                        long id = cursor.getLong(0);
                        String name = cursor.getString(1);
                        Uri uri = ContentUris.withAppendedId(collection, id);
                        String thumbnail = thumbnailFor(id, uri);
                        if (thumbnail == null) {
                            continue;
                        }
                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(id));
                        item.put("name", name == null ? "photo-" + id + ".jpg" : name);
                        item.put("thumbnail", thumbnail);
                        photos.put(item);
                    }
                } catch (Exception error) {
                    Log.w(TAG, "query failed: " + error.getMessage());
                    call.reject("query failed: " + error.getMessage());
                    return;
                }
                JSObject result = new JSObject();
                result.put("photos", photos);
                call.resolve(result);
            },
            "recent-photos-list"
        ).start();
    }

    /** 把用户点选的原图复制到缓存目录，返回路径与元信息 */
    @PluginMethod
    public void read(final PluginCall call) {
        if ("none".equals(accessState())) {
            call.reject("denied");
            return;
        }
        final String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        new Thread(
            () -> {
                ContentResolver resolver = getContext().getContentResolver();
                Uri uri;
                try {
                    uri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        Long.parseLong(id)
                    );
                } catch (NumberFormatException error) {
                    call.reject("invalid id");
                    return;
                }
                String name = displayName(uri);
                String mime = resolver.getType(uri);
                if (name == null) {
                    name = "photo-" + id + (mime != null && mime.contains("png") ? ".png" : ".jpg");
                }
                File dir = new File(getContext().getCacheDir(), "recent-originals");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("cache unavailable");
                    return;
                }
                // 同名文件可能来自另一张图，带上 id 前缀避免串图
                File target = new File(dir, id + "-" + name);
                if (!target.exists() || target.length() == 0) {
                    try (
                        InputStream input = resolver.openInputStream(uri);
                        OutputStream output = new FileOutputStream(target)
                    ) {
                        if (input == null) {
                            call.reject("cannot open photo");
                            return;
                        }
                        copy(input, output);
                    } catch (Exception error) {
                        Log.w(TAG, "read failed: " + error.getMessage());
                        call.reject("read failed: " + error.getMessage());
                        return;
                    }
                }
                JSObject result = new JSObject();
                result.put("path", Uri.fromFile(target).toString());
                result.put("name", name);
                result.put("size", target.length());
                result.put("mime", mime == null ? "image/jpeg" : mime);
                call.resolve(result);
            },
            "recent-photos-read"
        ).start();
    }

    /** 缩略图：26~28 用系统缩略图表，29+ 用 loadThumbnail */
    private String thumbnailFor(long id, Uri uri) {
        File dir = new File(getContext().getCacheDir(), "recent-thumbs");
        if (!dir.exists() && !dir.mkdirs()) {
            return null;
        }
        File target = new File(dir, id + ".jpg");
        if (target.exists() && target.length() > 0) {
            return Uri.fromFile(target).toString();
        }
        Bitmap bitmap = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bitmap = getContext().getContentResolver().loadThumbnail(uri, new Size(240, 240), null);
            } else {
                bitmap = MediaStore.Images.Thumbnails.getThumbnail(
                    getContext().getContentResolver(),
                    id,
                    MediaStore.Images.Thumbnails.MINI_KIND,
                    null
                );
            }
        } catch (Exception error) {
            Log.w(TAG, "thumbnail failed: " + error.getMessage());
        }
        if (bitmap == null) {
            return null;
        }
        try (FileOutputStream output = new FileOutputStream(target)) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output);
        } catch (Exception error) {
            Log.w(TAG, "thumbnail write failed: " + error.getMessage());
            return null;
        } finally {
            bitmap.recycle();
        }
        return Uri.fromFile(target).toString();
    }

    private String displayName(Uri uri) {
        String[] projection = { MediaStore.Images.Media.DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception error) {
            Log.w(TAG, "name lookup failed: " + error.getMessage());
        }
        return null;
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        output.flush();
    }

    private void resolveState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", accessState());
        call.resolve(result);
    }

    private String accessState() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (granted(Manifest.permission.READ_MEDIA_IMAGES)) {
                return "full";
            }
            return granted(PERMISSION_PARTIAL) ? "limited" : "none";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES) ? "full" : "none";
        }
        return granted(Manifest.permission.READ_EXTERNAL_STORAGE) ? "full" : "none";
    }

    /** Android 14 同时请求两项，系统才会给出「选择照片」这个选项 */
    private String[] requiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            List<String> permissions = new ArrayList<>();
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES);
            permissions.add(PERMISSION_PARTIAL);
            return permissions.toArray(new String[0]);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[] { Manifest.permission.READ_MEDIA_IMAGES };
        }
        return new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
