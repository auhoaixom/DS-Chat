package com.dschat.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemBarPlugin.class);
        registerPlugin(ClipboardPlugin.class);
        registerPlugin(RecentPhotosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
