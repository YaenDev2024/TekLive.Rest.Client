package com.teklive.rest;

import android.os.Bundle;
import android.os.SystemClock;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Updater nativo (auto-update del APK), ícono de la app (presets y
     * acceso directo con el logo de la empresa) y splash de marca (alita de
     * Crazzy Wings).
     *
     * El orden importa en Capacitor 6: `registerPlugin()` sólo añade la clase al
     * `bridgeBuilder`; el bridge se construye dentro de `super.onCreate()`.
     * Registrarlo después no falla, simplemente el plugin no existe para JS.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // installSplashScreen() ANTES de super.onCreate(): así
        // AppTheme.NoActionBarLaunch (splash) se cambia a postSplashScreenTheme
        // cuando el sistema desmonta el splash, que es cuando ya hay contenido.
        // Sin esto la app se queda con el tema de arranque y el splash parpadea
        // sobre el login.
        SplashScreen splash = SplashScreen.installSplashScreen(this);

        registerPlugin(RestUpdaterPlugin.class);
        registerPlugin(RestIconPlugin.class);
        super.onCreate(savedInstanceState);

        final long start = SystemClock.uptimeMillis();
        // Mantiene el splash hasta que el WebView pinta su primer frame, para
        // que no se vea una ventana vacía entre el splash y la app.
        //
        // El tope de 2.5 s NO es opcional: si el WebView no llega a completar
        // la carga (sin red, error del backend, JS roto) getProgress() se queda
        // por debajo de 100 y sin este límite el splash taparía la app para
        // siempre, que es peor que un parpadeo.
        splash.setKeepOnScreenCondition(() -> {
            if (SystemClock.uptimeMillis() - start > 2500) {
                return false;
            }
            return getBridge() == null
                    || getBridge().getWebView() == null
                    || getBridge().getWebView().getProgress() < 100;
        });
    }
}
