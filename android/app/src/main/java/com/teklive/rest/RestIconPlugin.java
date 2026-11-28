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
 * El ÍCONO DE LA APP ES ESTÁTICO: va empaquetado en el APK con la marca del
 * cliente (alita de Crazy Wings) porque el sistema se vende a una sola empresa.
 * No hay selector de íconos en la UI.
 *
 * Mecanismo que queda:
 *
 * - SHORTCUT FIJADO (`pinCompanyShortcut` / `removeCompanyShortcut`): un acceso
 *   directo en la pantalla de inicio cuyo ícono es un Bitmap ARBITRARIO, bajado
 *   del endpoint público de logos. Es la única vía para que el logo real de la
 *   empresa aparezca en el dispositivo. Android pide confirmación al usuario y
 *   el ícono es adicional: no reemplaza al de la app.
 *
 * Los cuatro `<activity-alias>` siguen declarados en el manifiesto aunque sólo
 * se use el `default`. No se pueden borrar sin riesgo: el estado habilitado de
 * un componente sobrevive a las actualizaciones, así que un equipo que hubiera
 * quedado con el alias "dark" activo se quedaría SIN punto de entrada en el
 * launcher si ese alias desapareciera del manifiesto. `ensureDefaultAlias()`
 * converge a todos a un único alias en el primer arranque.
 *
 * Reglas que este archivo respeta:
 * - Nunca se habilita/deshabilita MainActivity. Sólo aliases. Deshabilitar la
 *   activity destino hace que el sistema mate la tarea y la app desaparezca de
 *   "recientes"; es un comportamiento documentado, no un bug.
 * - Al terminar `ensureDefaultAlias()` queda EXACTAMENTE un alias habilitado.
 * - La red nunca corre en el hilo UI (NetworkOnMainThreadException).
 */
@CapacitorPlugin(name = "RestIcon")
public class RestIconPlugin extends Plugin {

    private static final String PREFS = "rest_icon_prefs";
    /** Marca de que el alias ya se normalizó al estático en este equipo. */
    private static final String KEY_ALIAS_NORMALIZED = "alias_normalized_to_static";
    /** Alias único habilitado: el ícono estático con la marca del cliente. */
    private static final String DEFAULT_PRESET = "default";

    private static final String SHORTCUT_ID = "company_logo_shortcut";

    /**
     * Prefijo de los ComponentName de los aliases. Va literal (igual que
     * FILE_PROVIDER_AUTHORITY en el updater) para que un cambio de
     * applicationId rompa el build de forma visible y no falle en runtime.
     */
    private static final String ALIAS_PREFIX = "com.teklive.rest.Icon";

    /** Aliases declarados en el manifiesto. Sólo `default` queda habilitado. */
    private static final String[] PRESETS = {"default", "dark", "light", "mono"};

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    /** Lado del bitmap del shortcut. 192 px cubre xxxhdpi sin desperdiciar RAM. */
    private static final int SHORTCUT_ICON_SIZE = 192;

    private ExecutorService io;

    @Override
    public void load() {
        io = Executors.newSingleThreadExecutor();
        // El ícono es estático: converge al alias único en el primer arranque
        // para que ningún equipo quede con un preset viejo activo.
        ensureDefaultAlias();
    }

    @Override
    protected void handleOnDestroy() {
        if (io != null) {
            io.shutdownNow();
            io = null;
        }
    }

    // --- Ícono estático ------------------------------------------------------

    /**
     * Converge al alias `default` una sola vez.
     *
     * El estado habilitado de un componente sobrevive a las actualizaciones del
     * APK. Un equipo que en una versión anterior hubiera elegido otro preset
     * seguiría con ese alias activo —y con el ícono viejo— aunque la UI ya no
     * ofrezca cambiarlo. Se ejecuta al cargar el plugin, antes de que la UI
     * pregunte nada.
     */
    private void ensureDefaultAlias() {
        SharedPreferences prefs = prefs();
        if (prefs.getBoolean(KEY_ALIAS_NORMALIZED, false)) return;

        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();

            // 1) Habilitar el default primero: nunca queda sin punto de entrada.
            pm.setComponentEnabledSetting(
                    new ComponentName(pkg, ALIAS_PREFIX + capitalize(DEFAULT_PRESET)),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);

            // 2) Deshabilitar el resto.
            for (String other : PRESETS) {
                if (DEFAULT_PRESET.equals(other)) continue;
                pm.setComponentEnabledSetting(
                        new ComponentName(pkg, ALIAS_PREFIX + capitalize(other)),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
            }

            prefs.edit()
                    .putBoolean(KEY_ALIAS_NORMALIZED, true)
                    .apply();
        } catch (Exception ex) {
            // Best-effort: si falla se reintenta en el próximo arranque.
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
                // Un alias concreto puede estar deshabilitado y el acceso
                // directo quedaría apuntando a un componente muerto.
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
