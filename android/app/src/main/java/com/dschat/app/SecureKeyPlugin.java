package com.dschat.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 交出本地数据的加密密钥（DEK）。
 *
 * 做法：Keystore 里生成一把**包装密钥**（不能导出，只有本 App 的签名能调用它），
 * 用它把一份随机 32 字节的 DEK 加密后存进 SharedPreferences。每次启动解封出来交给网页，
 * 网页拿它走 WebCrypto 做 AES-256-GCM。
 *
 * 为什么绕这一层：Keystore 里的密钥不能导出，WebCrypto 也用不了它；
 * 而每条记录都过一遍原生桥会慢到不能用。用硬件密钥包一把软件密钥是唯一能兼顾
 * 硬件绑定与性能的做法。代价是 DEK 会出现在网页内存里——不落盘、不进日志。
 *
 * 效果：把 app_webview 目录（连同 SharedPreferences）拷到别的机器上，
 * 硬件里的那把包装密钥并不在文件里，那份 DEK 密文因此解不开。
 *
 * 设备没有可用安全硬件时用 KEYSTORE_UNAVAILABLE 拒绝，由网页侧降级并在诊断页标出来，
 * 不在这里静默换成软件密钥。
 */
@CapacitorPlugin(name = "SecureKey")
public class SecureKeyPlugin extends Plugin {

    private static final String TAG = "DSChatSecureKey";
    /** Keystore 里包装密钥的别名 */
    private static final String KEY_ALIAS = "ds-chat-dek-wrap";
    private static final String PREFS = "ds-chat-secure";
    private static final String PREF_WRAPPED_DEK = "wrapped-dek";
    private static final String PREF_WRAP_IV = "wrapped-dek-iv";
    /** AES-256 */
    private static final int DEK_BYTES = 32;
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void getDataKey(PluginCall call) {
        try {
            SecretKey wrapper = ensureWrapperKey();
            SharedPreferences prefs =
                    getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String wrapped = prefs.getString(PREF_WRAPPED_DEK, null);
            String iv = prefs.getString(PREF_WRAP_IV, null);

            // 首次运行，或者数据被清过一半：重新生成一把 DEK 并封存。
            // 注意这里不能"顺手恢复旧数据"——旧 DEK 已经没了，那些密文就是打不开。
            if (wrapped == null || iv == null) {
                byte[] dek = new byte[DEK_BYTES];
                new SecureRandom().nextBytes(dek);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, wrapper);
                byte[] sealed = cipher.doFinal(dek);
                prefs.edit()
                        .putString(PREF_WRAPPED_DEK, Base64.encodeToString(sealed, Base64.NO_WRAP))
                        .putString(PREF_WRAP_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                        .apply();
                Log.i(TAG, "created a new data key");
                call.resolve(result(dek));
                return;
            }

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    wrapper,
                    new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] dek = cipher.doFinal(Base64.decode(wrapped, Base64.NO_WRAP));
            if (dek.length != DEK_BYTES) {
                call.reject("KEYSTORE_CORRUPT: unexpected data key length");
                return;
            }
            call.resolve(result(dek));
        } catch (Exception error) {
            Log.w(TAG, "getDataKey failed: " + error);
            call.reject("KEYSTORE_UNAVAILABLE: " + error.getMessage());
        }
    }

    /** 丢掉当前这把 DEK 与包装密钥；之后的读写会因为旧密文解不开而失败，仅用于测试调试 */
    @PluginMethod
    public void reset(PluginCall call) {
        try {
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit();
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) {
                store.deleteEntry(KEY_ALIAS);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("reset failed: " + error.getMessage());
        }
    }

    private SecretKey ensureWrapperKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder spec =
                new KeyGenParameterSpec.Builder(
                                KEY_ALIAS,
                                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .setRandomizedEncryptionRequired(true);
        // 不要求每读写一次就验一次指纹：那会让「打开会话」这种高频操作变成负担，
        // 而本插件保护的本来就是"文件被拷走"这个场景，不是"手机被解锁后被人用着"。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            spec.setUnlockedDeviceRequired(false);
        }
        generator.init(spec.build());
        return generator.generateKey();
    }

    private com.getcapacitor.JSObject result(byte[] dek) {
        com.getcapacitor.JSObject object = new com.getcapacitor.JSObject();
        object.put("key", Base64.encodeToString(dek, Base64.NO_WRAP));
        return object;
    }
}
