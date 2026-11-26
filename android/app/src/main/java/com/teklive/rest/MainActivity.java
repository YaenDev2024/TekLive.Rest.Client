package com.teklive.rest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Updater nativo (auto-update del APK).
     *
     * El orden importa en Capacitor 6: `registerPlugin()` sólo añade la clase al
     * `bridgeBuilder`; el bridge se construye dentro de `super.onCreate()`.
     * Registrarlo después no falla, simplemente el plugin no existe para JS.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
