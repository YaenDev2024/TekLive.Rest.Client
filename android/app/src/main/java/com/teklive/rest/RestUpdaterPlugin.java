package com.teklive.rest;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Updater Android nativo (TekLive Rest).
 *
 * Por qué un plugin local y no una dependencia npm:
 * - `@capawesome/capacitor-app-update` apunta a Play In-App Updates; Rest se
 *   distribuye como APK fuera de la tienda.
 * - `@capacitor/filesystem` + fetch obliga a que el APK (~20-50 MB) cruce el
 *   bridge como base64: eso es cargar el APK entero (y su copia base64) en la
 *   memoria de un WebView de gama baja.
 *
 * Reglas que este archivo NO se salta:
 * 1. El APK se escribe por streaming con buffer de 8 KB. Nunca se materializa
 *    en memoria.
 * 2. Nada se instala sin SHA-256 verificado contra el manifiesto (más el
 *    tamaño) y sin comparar el certificado firmante con el del paquete
 *    instalado. Un CDN mal configurado no puede colar un APK ajeno.
 * 3. Toda la red y el IO corren fuera del hilo UI (NetworkOnMainThreadException
 *    + ANR). Sólo `install()` toca el hilo principal, porque startActivity lo
 *    exige.
 * 4. `versionCode` (long) es la única fuente de verdad del orden de versiones.
 *
 * Contrato idéntico al del cliente de TekLive Market (MarketUpdaterPlugin): el
 * JS de src/services/update-android.ts es el que manda.
 */
@CapacitorPlugin(name = "RestUpdater")
public class RestUpdaterPlugin extends Plugin {

    /**
     * Authority declarada en AndroidManifest.xml para el FileProvider. Se deja
     * literal (en vez de getPackageName() + sufijo) para que un cambio de
     * applicationId rompa el build de forma visible en vez de fallar en runtime.
     */
    private static final String FILE_PROVIDER_AUTHORITY = "com.teklive.rest.fileprovider";

    /** Subdirectorio del cacheDir de la app (privado, sin permisos de storage). */
    private static final String UPDATES_DIR = "updates";

    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 120_000;
    /** El APK nunca se carga completo: 8 KB por lectura. */
    private static final int BUFFER_SIZE = 8 * 1024;
    /** Margen de espacio libre exigido sobre el tamaño del APK. */
    private static final double FREE_SPACE_FACTOR = 1.5;

    /**
     * Un solo hilo: dos descargas simultáneas no aportan nada y multiplicarían
     * el consumo de datos de un equipo con red mala.
     */
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

    // --- Info del paquete instalado -----------------------------------------

    /**
     * { versionCode, versionName, abi, signerSha256, sdkInt }
     *
     * `sdkInt` es un añadido al contrato: el manifiesto trae `minSdk` y JS
     * necesita el SDK del device para comprobarlo antes de descargar decenas de
     * MB. Exponerlo aquí ahorra un método nativo extra.
     */
    @PluginMethod
    public void getInstalledInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo info = pm.getPackageInfo(pkg, signingFlags());

            JSObject ret = new JSObject();
            ret.put("versionCode", PackageInfoCompat.getLongVersionCode(info));
            ret.put("versionName", info.versionName == null ? "" : info.versionName);
            String[] abis = Build.SUPPORTED_ABIS;
            ret.put("abi", (abis != null && abis.length > 0) ? abis[0] : "");
            ret.put("signerSha256", signerSha256(info));
            ret.put("sdkInt", Build.VERSION.SDK_INT);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("No se pudo leer la información de la app instalada.", ex);
        }
    }

    // --- Descarga ------------------------------------------------------------

    /**
     * download({ url, sha256, size, fileName }) -> { path, size }
     *
     * Destino: cacheDir/updates/<fileName saneado>. El cacheDir es privado de
     * la app y el SO lo purga si nunca se instala.
     */
    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256");
        final String fileName = call.getString("fileName");
        final Long size = call.getLong("size", 0L);

        if (url == null || url.trim().isEmpty()) {
            call.reject("url_required");
            return;
        }
        if (sha256 == null || sha256.trim().isEmpty()) {
            call.reject("sha256_required");
            return;
        }
        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("fileName_required");
            return;
        }
        if (io == null) {
            call.reject("plugin_destroyed");
            return;
        }

        final long expectedSize = size == null ? 0L : size;
        io.execute(() -> downloadInBackground(call, url.trim(), sha256.trim(), expectedSize, fileName.trim()));
    }

    private void downloadInBackground(PluginCall call, String url, String sha256, long expectedSize, String fileName) {
        // El manifiesto lo controla el backend, pero una URL http permitiría
        // que un intermediario sustituya el APK (aunque el SHA-256 lo corta, se
        // evita el viaje en claro).
        if (!url.toLowerCase(Locale.US).startsWith("https://")) {
            call.reject("invalid_url");
            return;
        }

        String normalizedSha = sha256.replace(":", "").replace(" ", "").toLowerCase(Locale.US);
        if (normalizedSha.length() != 64) {
            call.reject("invalid_sha256");
            return;
        }

        // Sanitizado del nombre: sólo el nombre base, sin separadores de ruta.
        // Se normaliza '\\' porque en Android el separador es '/' y un nombre
        // con backslashes pasaría el getName() tal cual.
        String safeName = new File(fileName.replace('\\', '/')).getName();
        if (safeName.isEmpty() || ".".equals(safeName) || "..".equals(safeName)) {
            call.reject("invalid_file_name");
            return;
        }

        File target = null;
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;

        try {
            File dir = new File(getContext().getCacheDir(), UPDATES_DIR);
            if (!dir.isDirectory() && !dir.mkdirs()) {
                call.reject("No se pudo preparar el directorio de descargas.");
                return;
            }
            target = new File(dir, safeName);

            // Espacio libre: el APK + 50% de margen (el SO también escribe
            // mientras el WebView sigue vivo).
            if (expectedSize > 0) {
                StatFs stat = new StatFs(getContext().getCacheDir().getAbsolutePath());
                long available = stat.getAvailableBytes();
                double required = expectedSize * FREE_SPACE_FACTOR;
                if (available < (long) required) {
                    call.reject("Espacio insuficiente para descargar la actualización.");
                    return;
                }
            }

            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/octet-stream");
            conn.setUseCaches(false);

            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                call.reject("download_failed_http_" + code);
                return;
            }

            // Content-Length: si el server lo manda debe coincidir con el
            // manifiesto. Si no lo manda (-1) el gate definitivo es el SHA-256.
            int declared = conn.getContentLength();
            if (declared > 0 && expectedSize > 0 && declared != expectedSize) {
                call.reject("size_mismatch");
                return;
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            in = new BufferedInputStream(conn.getInputStream(), BUFFER_SIZE);
            out = new FileOutputStream(target);

            byte[] buffer = new byte[BUFFER_SIZE];
            long total = 0L;
            int lastPct = -1;
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                // El digest se calcula al vuelo: no hay que releer el archivo ni
                // guardarlo en memoria.
                digest.update(buffer, 0, read);
                total += read;
                if (expectedSize > 0) {
                    int pct = (int) Math.min(99L, (total * 100L) / expectedSize);
                    if (pct != lastPct) {
                        lastPct = pct;
                        emitProgress(pct);
                    }
                }
            }
            out.flush();
            out.close();
            out = null;
            in.close();
            in = null;

            if (expectedSize > 0 && total != expectedSize) {
                deleteQuietly(target);
                call.reject("size_mismatch");
                return;
            }

            String actual = toHex(digest.digest());
            if (!actual.equalsIgnoreCase(normalizedSha)) {
                // Gate anti-basura: se borra siempre, nunca queda un APK
                // inválido en cache listo para que alguien lo instale.
                deleteQuietly(target);
                call.reject("checksum_mismatch");
                return;
            }

            emitProgress(100);
            JSObject ret = new JSObject();
            ret.put("path", target.getAbsolutePath());
            ret.put("size", total);
            call.resolve(ret);
        } catch (Exception ex) {
            if (target != null) deleteQuietly(target);
            call.reject("No se pudo descargar la actualización.", ex);
        } finally {
            closeQuietly(in);
            closeQuietly(out);
            if (conn != null) conn.disconnect();
        }
    }

    // --- Validación del APK descargado --------------------------------------

    /**
     * isPackageCompatible({ path }) -> { compatible, reason? }
     *
     * Tres gates antes de ofrecer instalar:
     * 1. packageName == el nuestro.
     * 2. Certificado firmante == el del paquete instalado. Sin esto Android
     *    responde "Aplicación no instalada", que el cajero no puede diagnosticar.
     * 3. versionCode del APK > instalado (nunca downgrade).
     */
    @PluginMethod
    public void isPackageCompatible(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("path_required");
            return;
        }

        JSObject ret = new JSObject();
        try {
            File apk = new File(path.trim());
            if (!apk.isFile()) {
                call.reject("file_not_found");
                return;
            }

            PackageManager pm = getContext().getPackageManager();
            PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlags());
            if (archive == null) {
                // APK corrupto o sin manifiesto legible.
                ret.put("compatible", false);
                ret.put("reason", "invalid_apk");
                call.resolve(ret);
                return;
            }

            String pkg = getContext().getPackageName();
            if (!pkg.equals(archive.packageName)) {
                ret.put("compatible", false);
                ret.put("reason", "package_mismatch");
                call.resolve(ret);
                return;
            }

            PackageInfo installed = pm.getPackageInfo(pkg, signingFlags());
            String apkSigner = signerSha256(archive);
            String installedSigner = signerSha256(installed);
            if (apkSigner.isEmpty() || !apkSigner.equals(installedSigner)) {
                ret.put("compatible", false);
                ret.put("reason", "signature_mismatch");
                call.resolve(ret);
                return;
            }

            long apkVersion = PackageInfoCompat.getLongVersionCode(archive);
            long installedVersion = PackageInfoCompat.getLongVersionCode(installed);
            if (apkVersion <= installedVersion) {
                ret.put("compatible", false);
                ret.put("reason", "not_newer");
                call.resolve(ret);
                return;
            }

            ret.put("compatible", true);
            ret.put("versionCode", apkVersion);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("No se pudo validar el paquete descargado.", ex);
        }
    }

    // --- Permiso de instalación ---------------------------------------------

    /** API >= 26 exige autorización explícita por app para instalar APKs. */
    private boolean canRequestInstalls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /**
     * Abre la pantalla de "Instalar apps desconocidas" de ESTA app. Antes de
     * llamarlo la UI debe explicar para qué se pide: es un ajuste del sistema,
     * no un diálogo de la app.
     */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(new JSObject());
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject());
        } catch (Exception ex) {
            call.reject("No se pudo abrir los ajustes de instalación.", ex);
        }
    }

    // --- Instalación ---------------------------------------------------------

    /**
     * install({ path }) -> { launched }
     *
     * Sólo se lanza el instalador del sistema (ACTION_VIEW sobre el APK vía
     * FileProvider). El usuario sigue confirmando en la pantalla de Android: la
     * app nunca instala en silencio ni puede hacerlo.
     */
    @PluginMethod
    public void install(final PluginCall call) {
        final String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("path_required");
            return;
        }
        final File apk = new File(path.trim());
        if (!apk.isFile()) {
            call.reject("file_not_found");
            return;
        }
        if (!canRequestInstalls()) {
            call.reject("install_permission_required");
            return;
        }

        // startActivity desde un hilo de background requiere NEW_TASK y aun así
        // es frágil: se lanza desde el hilo principal, que es donde vive la
        // Activity.
        getBridge().executeOnMainThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(getContext(), FILE_PROVIDER_AUTHORITY, apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("launched", true);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("No se pudo abrir el instalador del sistema.", ex);
            }
        });
    }

    /**
     * Borra los APK descargados (cacheDir/updates). Se llama al detectar que la
     * instalación terminó: el archivo ya no sirve para nada y ocupa decenas de
     * MB.
     */
    @PluginMethod
    public void clearDownloads(final PluginCall call) {
        if (io == null) {
            call.reject("plugin_destroyed");
            return;
        }
        io.execute(() -> {
            deleteRecursive(new File(getContext().getCacheDir(), UPDATES_DIR));
            call.resolve(new JSObject());
        });
    }

    // --- Helpers -------------------------------------------------------------

    /**
     * Flags de firma según API: GET_SIGNING_CERTIFICATES existe desde 28. En
     * versiones anteriores la firma vive en PackageInfo.signatures.
     */
    private int signingFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return PackageManager.GET_SIGNING_CERTIFICATES;
        }
        return PackageManager.GET_SIGNATURES;
    }

    /**
     * SHA-256 del primer certificado firmante en hex MAYÚSCULAS separado por dos
     * puntos ("0F:7B:98:..."), el mismo formato que `keytool -list -v` para que
     * soporte pueda comparar a ojo.
     */
    private String signerSha256(PackageInfo info) throws Exception {
        Signature[] signatures = signaturesOf(info);
        if (signatures == null || signatures.length == 0) return "";

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(signatures[0].toByteArray());

        StringBuilder sb = new StringBuilder(hash.length * 3);
        for (int i = 0; i < hash.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format(Locale.US, "%02X", hash[i] & 0xFF));
        }
        return sb.toString();
    }

    private Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = info.signingInfo;
            if (signingInfo == null) return null;
            // getApkContentsSigners devuelve los firmantes reales del APK (no el
            // historial de rotación), que es lo que Android compara al instalar
            // la actualización.
            return signingInfo.getApkContentsSigners();
        }
        return info.signatures;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b & 0xFF));
        }
        return sb.toString();
    }

    /** Progreso por evento (0-100). Sin listeners el bridge lo ignora. */
    private void emitProgress(int pct) {
        if (!hasListeners("downloadProgress")) return;
        JSObject data = new JSObject();
        data.put("progress", pct);
        notifyListeners("downloadProgress", data);
    }

    private static void deleteQuietly(File file) {
        if (file == null) return;
        try {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        } catch (Exception ignored) {
            // best-effort: el cacheDir lo purga el SO si no se pudo borrar.
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        deleteQuietly(file);
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (Exception ignored) {
            // best-effort
        }
    }
}
