package com.teklive.rest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Updater nativo (auto-update del APK) e ícono de la app (presets y
     * acceso directo con el logo de la empresa).
     *
     * El orden importa en Capacitor 6: `registerPlugin()` sólo añade la clase al
     * `bridgeBuilder`; el bridge se construye dentro de `super.onCreate()`.
     * Registrarlo después no falla, simplemente el plugin no existe para JS.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestUpdaterPlugin.class);
        registerPlugin(RestIconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
