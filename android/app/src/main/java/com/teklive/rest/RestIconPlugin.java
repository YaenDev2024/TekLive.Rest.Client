package com.teklive.rest;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ícono de la app Android (TekLive Rest).
 *
 * Dos mecanismos distintos, con capacidades distintas:
 *
 * 1. PRESETS (`setPreset` / `listPresets`): el ícono del cajón de apps se
 *    cambia habilitando/deshabilitando un <activity-alias> con
 *    PackageManager.setComponentEnabledSetting. El ícono de cada alias es un
 *    recurso del APK (`@mipmap/ic_launcher_<preset>`), así que aquí NO se puede
 *    usar el logo subido por la empresa: sólo variantes empaquetadas. Es el
 *    mismo mecanismo que usan WhatsApp o Instagram para sus íconos alternativos.
 *
 * 2. SHORTCUT FIJADO (`pinCompanyShortcut` / `removeCompanyShortcut`): un acceso
 *    directo en la pantalla de inicio cuyo ícono es un Bitmap ARBITRARIO, bajado
 *    del endpoint público de logos. Es la única vía para que el logo real de la
 *    empresa aparezca en el dispositivo. Android pide confirmación al usuario y
 *    el ícono es adicional: no reemplaza al de la app.
 *
 * Reglas que este archivo respeta:
 * - Nunca se habilita/deshabilita MainActivity. Sólo aliases. Deshabilitar la
 *   activity destino hace que el sistema mate la tarea y la app desaparezca de
 *   "recientes"; es un comportamiento documentado, no un bug.
 * - Siempre queda EXACTAMENTE un alias habilitado: primero se habilita el nuevo
 *   y después se deshabilita el anterior, para que el launcher no vea un
 *   instante sin punto de entrada.
 * - La red nunca corre en el hilo UI (NetworkOnMainThreadException).
 * - El preset elegido se guarda en SharedPreferences y no en el manifiesto, así
 *   que sobrevive a las actualizaciones del APK.
 */
@CapacitorPlugin(name = "RestIcon")
public class RestIconPlugin extends Plugin {

    private static final String PREFS = "rest_icon_prefs";
    private static final String KEY_PRESET = "preset";

    private static final String SHORTCUT_ID = "company_logo_shortcut";

    /** Nombre del paquete, para resolver los ComponentName de los alias. */
    private static final String ALIAS_PREFIX = "com.teklive.rest.Icon";

    /** Presets soportados; el orden es el que ve la UI. */
    private static final String[] PRESETS = {"default", "dark", "light", "mono"};

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    /** Lado del bitmap del shortcut. 192 px cubre xxxhdpi sin desperdiciar RAM. */
    private static final int SHORTCUT_ICON_SIZE = 192;

    private ExecutorService io;

    @Override
    public void load() {
        io = Executors.newSingleThreadExecutor();
    }

    @Override
    protected void handleOnDestroy() {
        if (io != null) {
            io.shutdownNow();
            io = null;
        }
    }

    // --- Presets de ícono ----------------------------------------------------

    /**
     * Presets disponibles y cuál está activo.
     * -> { presets: [{id, label}], current }
     */
    @PluginMethod
    public void listPresets(PluginCall call) {
        JSArray presets = new JSArray();
        for (String preset : PRESETS) {
            JSObject item = new JSObject();
            item.put("id", preset);
            item.put("label", labelFor(preset));
            presets.put(item);
        }
        JSObject ret = new JSObject();
        ret.put("presets", presets);
        ret.put("current", currentPreset());
        call.resolve(ret);
    }

    /**
     * setPreset({ preset }) -> { preset }
     *
     * Habilita el alias del preset pedido y deshabilita los demás. Este cambio
     * SÍ puede cerrar la app si el lanzador recrea la tarea, por eso la UI debe
     * avisar antes al usuario.
     */
    @PluginMethod
    public void setPreset(PluginCall call) {
        String preset = call.getString("preset");
        if (preset == null || !isKnownPreset(preset)) {
            call.reject("Preset de ícono desconocido: " + preset);
            return;
        }

        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();

            // 1) Habilitar el elegido primero: nunca queda la app sin entrada.
            pm.setComponentEnabledSetting(
                    new ComponentName(pkg, ALIAS_PREFIX + capitalize(preset)),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);

            // 2) Deshabilitar el resto.
            for (String other : PRESETS) {
                if (other.equals(preset)) continue;
                pm.setComponentEnabledSetting(
                        new ComponentName(pkg, ALIAS_PREFIX + capitalize(other)),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
            }

            prefs().edit().putString(KEY_PRESET, preset).apply();

            JSObject ret = new JSObject();
            ret.put("preset", preset);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("No se pudo cambiar el ícono de la app.", ex);
        }
    }

    // --- Shortcut con el logo de la empresa ----------------------------------

    /**
     * pinCompanyShortcut({ url, label }) -> { pinned }
     *
     * Descarga `url` (el logo público de la empresa), la recorta a cuadrado y
     * pide a Android fijar un acceso directo con ese bitmap. Android pide
     * confirmación al usuario; `pinned: true` sólo significa que la petición se
     * envió, no que el usuario aceptó (no hay callback fiable en API 22).
     */
    @PluginMethod
    public void pinCompanyShortcut(final PluginCall call) {
        final String url = call.getString("url");
        final String label = call.getString("label", "TekLive Rest");

        if (url == null || url.trim().isEmpty()) {
            call.reject("Falta la URL del logo.");
            return;
        }
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(getContext())) {
            call.reject("Este lanzador no permite fijar accesos directos.");
            return;
        }

        io.execute(() -> {
            try {
                Bitmap bitmap = downloadBitmap(url);
                if (bitmap == null) {
                    call.reject("No se pudo descargar el logo de la empresa.");
                    return;
                }

                Context ctx = getContext();
                IconCompat icon = IconCompat.createWithBitmap(bitmap);

                // Destino: MainActivity directamente, NO el alias activo.
                // Un alias concreto se deshabilita al cambiar de preset y el
                // acceso directo quedaría apuntando a un componente muerto.
                // MainActivity está siempre habilitada y es exported, así que un
                // Intent explícito la abre sin depender de los intent-filters.
                ComponentName target = new ComponentName(ctx.getPackageName(), MainActivity.class.getName());

                android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_MAIN)
                        .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
                        .setComponent(target)
                        .setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                                | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);

                ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(ctx, SHORTCUT_ID)
                        .setShortLabel(label)
                        .setLongLabel(label)
                        .setIcon(icon)
                        .setIntent(intent)
                        .build();

                boolean ok = ShortcutManagerCompat.requestPinShortcut(ctx, shortcut, null);

                JSObject ret = new JSObject();
                ret.put("pinned", ok);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("No se pudo fijar el acceso directo.", ex);
            }
        });
    }

    /**
     * removeCompanyShortcut() -> { removed }
     *
     * Quita el acceso directo fijado. Si el usuario lo borró a mano, Android
     * devuelve false y no es un error.
     */
    @PluginMethod
    public void removeCompanyShortcut(PluginCall call) {
        try {
            List<String> ids = new ArrayList<>();
            ids.add(SHORTCUT_ID);
            ShortcutManagerCompat.removeLongLivedShortcuts(getContext(), ids);
            JSObject ret = new JSObject();
            ret.put("removed", true);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("No se pudo quitar el acceso directo.", ex);
        }
    }

    // --- Internos ------------------------------------------------------------

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Preset activo. Se lee de preferencias; si no hay nada guardado se infiere
     * del alias realmente habilitado (primer arranque tras instalar o tras
     * actualizar desde una versión sin este plugin).
     */
    private String currentPreset() {
        String saved = prefs().getString(KEY_PRESET, null);
        if (saved != null && isKnownPreset(saved)) return saved;

        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        for (String preset : PRESETS) {
            int state = pm.getComponentEnabledSetting(
                    new ComponentName(pkg, ALIAS_PREFIX + capitalize(preset)));
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                return preset;
            }
        }
        return "default";
    }

    private static boolean isKnownPreset(String preset) {
        for (String known : PRESETS) {
            if (known.equals(preset)) return true;
        }
        return false;
    }

    private static String labelFor(String preset) {
        switch (preset) {
            case "dark": return "Oscuro";
            case "light": return "Claro";
            case "mono": return "Monocromo";
            default: return "Predeterminado";
        }
    }

    private static String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** Descarga y recorta el logo a un cuadrado centrado del tamaño del shortcut. */
    private Bitmap downloadBitmap(String urlStr) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "image/*");

            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) return null;

            try (InputStream in = conn.getInputStream()) {
                // decodeStream devuelve null si el cuerpo no es una imagen.
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw == null) return null;
                return squareCrop(raw);
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * Recorte cuadrado centrado. Los lanzadores recortan igual (círculo,
     * squircle, etc.), así que centrar evita que el logo salga descolocado.
     */
    private static Bitmap squareCrop(Bitmap src) {
        int w = src.getWidth();
        int h = src.getHeight();
        int side = Math.min(w, h);
        int x = (w - side) / 2;
        int y = (h - side) / 2;

        Bitmap cropped = Bitmap.createBitmap(src, x, y, side, side);
        Bitmap scaled = Bitmap.createScaledBitmap(
                cropped, SHORTCUT_ICON_SIZE, SHORTCUT_ICON_SIZE, true);

        if (cropped != src) cropped.recycle();
        if (scaled != src && scaled != cropped) src.recycle();
        return scaled;
    }
}
