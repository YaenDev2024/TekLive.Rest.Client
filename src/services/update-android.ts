/**
 * TekLive Rest · Auto-update Android (APK fuera de Play Store).
 *
 * Flujo (igual de silencioso que el de desktop):
 * 1. Al arrancar y al volver al foreground: si pasaron 15 min desde el último
 *    chequeo (persistido, así el throttle sobrevive a cerrar la app), se pide
 *    el manifiesto anónimo de /api/rest/android/updates/latest.json.
 * 2. `versionCode` del manifiesto > `versionCode` instalado -> se descarga el
 *    APK al cache (streaming nativo, nunca en memoria) y se verifican tamaño,
 *    SHA-256 y certificado firmante antes de ofrecer nada.
 * 3. El usuario decide instalar. Antes se consulta el guard: instalar mata la
 *    app y una orden a medio capturar se perdería.
 * 4. Si falta el permiso "instalar apps desconocidas", se abre el ajuste del
 *    sistema y el usuario reintenta.
 *
 * Por qué NO se usa el ActivityResult del instalador: muchos OEM devuelven
 * RESULT_CANCELED siempre. La fuente de verdad es releer `getInstalledInfo()`
 * al volver al foreground y comparar `versionCode`.
 *
 * Por qué NO hay reintento tras `checksum_mismatch`: un CDN mal configurado
 * haría un bucle que quema los datos del cliente. La versión se marca como
 * bloqueada (persistido) y no se vuelve a descargar.
 *
 * Todo el servicio es no-op fuera de Android y cualquier error es silencioso:
 * la app debe abrir y vender igual sin red, sin endpoint o sin plugin.
 */

import { readonly, ref } from 'vue'
import { getPlatform } from './device'
import { canInstallNow } from './update-guard'
import { parseAndroidManifest, resolveAndroidManifestUrl } from './update-manifest'
import type { AndroidUpdateManifest } from './update-manifest'

export type AndroidUpdateStage = 'idle' | 'downloading' | 'ready' | 'installing'

export interface AndroidUpdateState {
  stage: AndroidUpdateStage
  /** 0-100 durante downloading. */
  progress: number
  /** versionName del manifiesto (sólo para mostrar; el orden lo da versionCode). */
  versionName: string
  /** versionCode del manifiesto. 0 = sin actualización conocida. */
  versionCode: number
  notes: string
  /**
   * `false` cuando el APK no se puede instalar (firma distinta, no es más
   * nuevo, paquete ajeno): el modal informa y NO ofrece instalar.
   */
  installable: boolean
  /** Falta el permiso del sistema "instalar apps desconocidas". */
  needsPermission: boolean
  /** Motivo humano por el que no se pudo descargar/instalar. */
  error: string
}

const state = ref<AndroidUpdateState>({
  stage: 'idle',
  progress: 0,
  versionName: '',
  versionCode: 0,
  notes: '',
  installable: false,
  needsPermission: false,
  error: '',
})

export const androidUpdateState = readonly(state)

/**
 * Throttle del MANIFIESTO, no del APK.
 *
 * El manifiesto es un JSON de ~1 KB: consultarlo seguido cuesta prácticamente
 * nada. Lo caro es el APK y eso ya está gobernado por `versionCode`: se
 * descarga una vez, se aplaza o se bloquea por versión concreta.
 */
const MANIFEST_THROTTLE_MS = 15 * 60 * 1000
/** Jitter del timer periódico: varios equipos tras el mismo NAT no salen a la vez. */
const JITTER_MAX_MS = 5 * 60 * 1000
/** Debounce del evento `online` (un parpadeo de red no dispara el chequeo). */
const ONLINE_DEBOUNCE_MS = 30 * 1000
/** Primer chequeo: deja montar la app y el POS antes de tocar red. */
const INITIAL_DELAY_MS = 8 * 1000
/** Timeout del fetch del manifiesto (es un JSON de 1 KB). */
const MANIFEST_TIMEOUT_MS = 20 * 1000

const DEFER_KEY_PREFIX = 'teklive_rest_android_update_deferred_'
const LAST_CHECK_KEY = 'teklive_rest_android_update_last_check'
const BLOCKED_KEY_PREFIX = 'teklive_rest_android_update_blocked_'
/**
 * APK ya descargado y verificado, persistido como
 * "<versionCode>|<versionName>|<ruta>".
 *
 * Sin esto, cerrar la app (o que el SO mate el WebView) olvidaba el APK y el
 * siguiente chequeo volvía a bajar la misma versión aunque el usuario la
 * hubiera aplazado. La ruta es la de `cacheDir/updates`, que el SO puede
 * purgar: por eso antes de reutilizarla se comprueba que siga siendo válida.
 */
const PENDING_KEY = 'teklive_rest_android_update_pending'

let started = false
let checking = false
let pendingApk: { path: string; versionCode: number; versionName: string } | null = null
/** versionCode que se mandó al instalador y cuyo resultado se espera. */
let awaitingVersionCode = 0
/** El modal se puede reabrir desde el indicador aunque esté aplazado. */
const modalOpen = ref(false)
/** Guard/instalación en curso: evita dos instalaciones en paralelo. */
const busyGuard = ref(false)
export const androidUpdateBusy = readonly(busyGuard)
/** Pausa del auto-show (el shell la activa en la pantalla de venta). */
const autoShowPaused = ref(false)
/** Versión que el usuario aplazó. 0 = sin aplazar. */
const deferredVersionCode = ref(0)
/** Limpieza del listener de progreso de la descarga en curso. */
let progressHandle: (() => void) | null = null

function setState(patch: Partial<AndroidUpdateState>): void {
  state.value = { ...state.value, ...patch }
}

/**
 * Lectura sin estrechamiento de TypeScript: `state` es readonly y el
 * compilador no ve que el flujo lo muta tras un `await`.
 */
function currentStage(): AndroidUpdateStage {
  return state.value.stage
}

function currentInstallable(): boolean {
  return state.value.installable
}

// --- Plugin nativo -----------------------------------------------------------

interface InstalledInfo {
  versionCode: number
  versionName: string
  abi: string
  signerSha256: string
  /** API level del device (para validar `minSdk` del manifiesto). */
  sdkInt: number
}

interface CompatibilityResult {
  compatible: boolean
  reason?: string
  versionCode?: number
}

interface RestUpdaterHandle {
  getInstalledInfo(): Promise<InstalledInfo>
  download(options: {
    url: string
    sha256: string
    size: number
    fileName: string
  }): Promise<{ path: string; size: number }>
  isPackageCompatible(options: { path: string }): Promise<CompatibilityResult>
  canInstallPackages(): Promise<{ allowed: boolean }>
  openInstallPermissionSettings(): Promise<void>
  install(options: { path: string }): Promise<{ launched: boolean }>
  clearDownloads(): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listener: (data: { progress: number }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

interface CapacitorCoreModule {
  registerPlugin<T>(name: string): T
}

let cachedPlugin: RestUpdaterHandle | null = null

/**
 * Carga perezosa del plugin.
 *
 * El import va SIN la anotación que desactiva el análisis de Vite: el paquete
 * se empaqueta y queda como un chunk propio. Si se anota y se usa un nombre en
 * constante, el bundle de producción conserva `import("@capacitor/core")` como
 * bare specifier, el WebView lo pide tal cual y devuelve 404: el updater queda
 * muerto en el APK y sólo se nota en el device.
 *
 * Devuelve `{ plugin }` y NO el proxy directamente: `registerPlugin()` de
 * Capacitor devuelve un Proxy que responde a CUALQUIER propiedad con una
 * función invocable, incluida `then`. Al resolver una promesa el motor de JS
 * comprueba si el valor es un thenable leyendo `.then`; el Proxy responde que
 * sí, lo invoca y el puente contesta
 * "RestUpdater.then() is not implemented on android". Envolverlo en un objeto
 * plano evita esa comprobación.
 */
async function loadPlugin(): Promise<{ plugin: RestUpdaterHandle } | null> {
  if (getPlatform() !== 'Android') return null
  if (cachedPlugin) return { plugin: cachedPlugin }
  try {
    const core = (await import('@capacitor/core')) as CapacitorCoreModule
    cachedPlugin = core.registerPlugin<RestUpdaterHandle>('RestUpdater')
    return { plugin: cachedPlugin }
  } catch {
    return null
  }
}

/** Código de error del plugin: Capacitor lo pone en `code` o en `message`. */
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown }
    if (typeof record.code === 'string' && record.code) return record.code
    if (typeof record.message === 'string') return record.message
  }
  return ''
}

/**
 * Versión instalada del APK según el sistema (`PackageManager`).
 *
 * Es la MISMA cifra contra la que el updater compara el manifiesto, así que
 * sirve para responder "¿por qué no se actualiza?" desde el propio equipo sin
 * depender de adb: si aquí dice 0.4.1 y el manifiesto 0.4.2, el updater tiene
 * que ofrecerlo; si no lo ofrece, el fallo está en el chequeo, no en el gate.
 * Devuelve `null` fuera de Android o si el plugin no responde.
 */
export async function readInstalledVersion(): Promise<{
  versionCode: number
  versionName: string
} | null> {
  const loaded = await loadPlugin()
  if (!loaded) return null
  try {
    const info = await loaded.plugin.getInstalledInfo()
    return { versionCode: info.versionCode, versionName: info.versionName }
  } catch {
    return null
  }
}

// --- Persistencia (throttle, aplazamiento, versiones bloqueadas) -------------

function readNumber(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Sin storage: el throttle queda sólo en memoria (se pierde al cerrar).
  }
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeString(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

/**
 * Marca el manifiesto como consultado. Se llama SIEMPRE que se hace el fetch,
 * haya versión nueva o no (un endpoint caído tampoco se reintenta cada minuto).
 */
function stampCheck(): void {
  writeNumber(LAST_CHECK_KEY, Date.now())
}

function isThrottled(): boolean {
  const last = readNumber(LAST_CHECK_KEY)
  if (last <= 0) return false
  return Date.now() - last < MANIFEST_THROTTLE_MS
}

function isBlocked(versionCode: number): boolean {
  return readNumber(BLOCKED_KEY_PREFIX + versionCode) > 0
}

/** Un checksum inválido bloquea esa versión para siempre en este device. */
function markBlocked(versionCode: number): void {
  writeNumber(BLOCKED_KEY_PREFIX + versionCode, Date.now())
}

function deferKey(versionCode: number): string {
  return DEFER_KEY_PREFIX + versionCode
}

function hasDeferred(versionCode: number): boolean {
  if (versionCode > 0 && deferredVersionCode.value === versionCode) return true
  return readNumber(deferKey(versionCode)) > 0
}

function pruneKeys(prefix: string, keep: string): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix) && key !== keep) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

function restoreDefer(versionCode: number): void {
  // Una versión nueva no hereda el aplazamiento de la anterior.
  deferredVersionCode.value = hasDeferred(versionCode) ? versionCode : 0
  pruneKeys(DEFER_KEY_PREFIX, deferKey(versionCode))
}

/** Guarda el APK pendiente para sobrevivir a un reinicio del WebView. */
function savePending(apk: { path: string; versionCode: number; versionName: string } | null): void {
  pendingApk = apk
  writeString(PENDING_KEY, apk ? `${apk.versionCode}|${apk.versionName}|${apk.path}` : '')
}

/**
 * Recupera el APK pendiente persistido, si el archivo sigue siendo instalable.
 *
 * El cacheDir lo puede purgar el SO, así que la ruta guardada no es garantía:
 * se revalida con el plugin nativo (existe, es nuestro paquete, misma firma y
 * más nuevo que lo instalado). Si algo falla se olvida el registro y el
 * siguiente chequeo descarga de nuevo, que es lo correcto.
 */
async function hydratePending(
  plugin: RestUpdaterHandle,
  installedVersionCode: number
): Promise<void> {
  if (pendingApk) return
  const raw = readString(PENDING_KEY)
  if (!raw) return

  // Formato: "<versionCode>|<versionName>|<path>". El path puede contener '|'
  // en teoría, así que sólo se parte en los dos primeros separadores.
  const first = raw.indexOf('|')
  const second = first > 0 ? raw.indexOf('|', first + 1) : -1
  if (first <= 0 || second <= first) {
    writeString(PENDING_KEY, '')
    return
  }

  const versionCode = Number(raw.slice(0, first))
  const versionName = raw.slice(first + 1, second)
  const path = raw.slice(second + 1)

  if (!Number.isInteger(versionCode) || versionCode <= 0 || !path) {
    writeString(PENDING_KEY, '')
    return
  }

  // Tras actualizar (o si el manifiesto retrocede) ese APK ya no adelanta a lo
  // instalado: es basura que ocupa decenas de MB.
  if (versionCode <= installedVersionCode) {
    writeString(PENDING_KEY, '')
    void plugin.clearDownloads().catch(() => undefined)
    return
  }

  const compatibility = await plugin.isPackageCompatible({ path }).catch(() => null)
  if (!compatibility || !compatibility.compatible) {
    writeString(PENDING_KEY, '')
    void plugin.clearDownloads().catch(() => undefined)
    return
  }

  pendingApk = { path, versionCode, versionName }
  // Se restaura el aplazamiento de ESA versión: si el usuario ya había dicho
  // "más tarde", reabrir la app no debe abrir el modal solo. El aviso queda
  // disponible en el indicador.
  restoreDefer(versionCode)
  setState({
    stage: 'ready',
    progress: 100,
    versionCode,
    versionName,
    installable: true,
    needsPermission: false,
    error: '',
  })
}

/** El usuario eligió "Más tarde". No vence: instalar es siempre manual. */
export function deferAndroidUpdate(): void {
  const versionCode = state.value.versionCode
  if (versionCode <= 0) return
  deferredVersionCode.value = versionCode
  writeNumber(deferKey(versionCode), Date.now())
  modalOpen.value = false
}

export function isAndroidUpdateDeferred(): boolean {
  return state.value.versionCode > 0 && deferredVersionCode.value === state.value.versionCode
}

export function canDeferAndroid(): boolean {
  return state.value.stage === 'ready'
}

export function shouldShowAndroidModal(): boolean {
  const stage = state.value.stage
  if (stage !== 'ready' && stage !== 'installing') return false
  if (modalOpen.value) return true
  if (autoShowPaused.value) return false
  // Un APK no instalable no merece interrumpir: se consulta desde el indicador.
  if (stage === 'ready' && !currentInstallable()) return false
  return !isAndroidUpdateDeferred()
}

export function pauseAndroidUpdateModalAutoShow(paused: boolean): void {
  autoShowPaused.value = paused
}

export function openAndroidUpdateModal(): void {
  if (state.value.stage !== 'ready' && state.value.stage !== 'installing') return
  modalOpen.value = true
}

export function closeAndroidUpdateModal(): void {
  modalOpen.value = false
}

export function isAndroidUpdateModalPinned(): boolean {
  return modalOpen.value
}

// --- Descarga ----------------------------------------------------------------

/** Texto para el usuario según el motivo que devolvió el plugin nativo. */
function compatibilityMessage(reason: string): string {
  switch (reason) {
    case 'signature_mismatch':
      return 'Esta actualización no es compatible con la versión instalada. Contacta a soporte.'
    case 'package_mismatch':
      return 'El archivo descargado pertenece a otra aplicación. Contacta a soporte.'
    case 'not_newer':
      return 'La actualización descargada no es más reciente que la instalada. Contacta a soporte.'
    default:
      return 'La actualización descargada está dañada. Contacta a soporte.'
  }
}

async function fetchManifest(): Promise<AndroidUpdateManifest | null> {
  // `no-store` es obligatorio: el endpoint manda Cache-Control no-cache y un
  // manifiesto viejo haría que un equipo no se enterara de la versión nueva.
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await fetch(resolveAndroidManifestUrl(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      // Endpoint anónimo: no se manda X-Api-Key ni cookies.
      credentials: 'omit',
    })
    if (!response.ok) return null
    return parseAndroidManifest((await response.json()) as unknown)
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

async function downloadApk(
  plugin: RestUpdaterHandle,
  manifest: AndroidUpdateManifest
): Promise<void> {
  const apk = manifest.apks.universal
  setState({
    stage: 'downloading',
    progress: 0,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    notes: manifest.notes,
    installable: false,
    error: '',
  })

  // Progreso best-effort: si el plugin no soporta listeners, la descarga sigue
  // igual (el estado se pone en 100 al terminar).
  try {
    const handle = await plugin.addListener('downloadProgress', ({ progress }) => {
      const pct = Number(progress)
      if (Number.isFinite(pct)) setState({ progress: Math.max(0, Math.min(100, Math.round(pct))) })
    })
    progressHandle = () => {
      void handle.remove().catch(() => undefined)
    }
  } catch {
    progressHandle = null
  }

  try {
    const downloaded = await plugin.download({
      url: apk.url,
      sha256: apk.sha256,
      size: apk.size,
      // Nombre derivado del versionCode: el manifiesto no impone ruta y así dos
      // versiones distintas nunca comparten archivo en cache.
      fileName: `TekLive-Rest-${manifest.versionCode}.apk`,
    })

    const compatibility = await plugin.isPackageCompatible({ path: downloaded.path })
    if (!compatibility.compatible) {
      // El APK ya está en cache pero no sirve: se olvida el registro (el
      // siguiente ciclo limpia las descargas huérfanas).
      pendingApk = null
      writeString(PENDING_KEY, '')
      setState({
        stage: 'ready',
        progress: 100,
        installable: false,
        error: compatibilityMessage(compatibility.reason ?? 'invalid_apk'),
      })
      return
    }

    savePending({
      path: downloaded.path,
      versionCode: manifest.versionCode,
      versionName: manifest.versionName,
    })
    setState({ stage: 'ready', progress: 100, installable: true, error: '' })
  } finally {
    progressHandle?.()
    progressHandle = null
  }
}

// --- Check -------------------------------------------------------------------

async function runCheck(): Promise<void> {
  if (getPlatform() !== 'Android') return
  if (checking) return
  if (currentStage() === 'downloading' || currentStage() === 'installing') return
  // Modo offline: ni siquiera intentar.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (isThrottled()) return

  checking = true
  try {
    const loaded = await loadPlugin()
    if (!loaded) return
    const plugin = loaded.plugin

    const installed = await plugin.getInstalledInfo()
    const manifest = await fetchManifest()
    // El ciclo se marca aunque el manifiesto venga roto: si el endpoint está
    // caído, no tiene sentido golpearlo en cada foreground.
    stampCheck()
    if (!manifest) return

    if (manifest.versionCode <= installed.versionCode) {
      // Ya estamos al día (o el APK del manifiesto es más viejo). Se limpia
      // cualquier APK huérfano de una sesión anterior.
      savePending(null)
      if (currentStage() === 'ready') {
        setState({ stage: 'idle', progress: 0, installable: false, error: '' })
      }
      void plugin.clearDownloads().catch(() => undefined)
      return
    }

    // Ya hay un APK descargado y verificado para ESTA MISMA versión: no se
    // vuelve a bajar. La comparación es contra el manifiesto, no una salida
    // temprana antes de consultarlo: si el usuario aplazó la 0.3.0 y se publica
    // la 0.4.0, debe enterarse igual (el aplazamiento es por versión).
    if (
      pendingApk &&
      pendingApk.versionCode === manifest.versionCode &&
      currentStage() === 'ready' &&
      currentInstallable()
    ) {
      return
    }

    // minSdk: no descargar decenas de MB para un APK que el sistema rechazará.
    if (manifest.minSdk > 0 && installed.sdkInt > 0 && manifest.minSdk > installed.sdkInt) {
      return
    }

    // Checksum inválido en un ciclo anterior: no se reintenta nunca.
    if (isBlocked(manifest.versionCode)) return

    // Versión nueva desplaza a una anterior a medio preparar: el APK viejo ya
    // no sirve y ocupa decenas de MB.
    if (pendingApk && pendingApk.versionCode !== manifest.versionCode) {
      savePending(null)
      void plugin.clearDownloads().catch(() => undefined)
    }

    restoreDefer(manifest.versionCode)
    await downloadApk(plugin, manifest)
  } catch (error) {
    // Silencioso de principio a fin, con una excepción deliberada: un fallo de
    // integridad deja rastro en el estado para que la UI no ofrezca instalar.
    if (errorCode(error) === 'checksum_mismatch') {
      const versionCode = state.value.versionCode
      if (versionCode > 0) markBlocked(versionCode)
      setState({
        stage: 'idle',
        progress: 0,
        installable: false,
        error: 'La actualización no pasó la verificación de integridad. Contacta a soporte.',
      })
      return
    }
    if (currentStage() === 'downloading') {
      setState({ stage: 'idle', progress: 0, installable: false, error: '' })
    }
  } finally {
    checking = false
  }
}

// --- Instalación -------------------------------------------------------------

async function openInstallPermission(plugin: RestUpdaterHandle): Promise<void> {
  setState({
    needsPermission: true,
    error:
      'Para instalar, permite «Instalar apps desconocidas» para TekLive Rest y vuelve a intentar.',
  })
  modalOpen.value = true
  try {
    await plugin.openInstallPermissionSettings()
  } catch {
    // Si no se puede abrir el ajuste, el mensaje ya explica qué hacer.
  }
}

/**
 * Instala el APK ya descargado. Antes exige el guard: en un POS matar la app a
 * media venta no es aceptable (mismo criterio que desktop).
 */
export async function installAndroidUpdate(): Promise<void> {
  if (getPlatform() !== 'Android') return
  const pending = pendingApk
  if (!pending || currentStage() !== 'ready' || !currentInstallable()) return
  if (busyGuard.value) return

  busyGuard.value = true
  setState({ error: '' })
  try {
    const guard = await canInstallNow().catch(() => ({ ok: true, reason: undefined }))
    if (!guard.ok) {
      setState({ error: guard.reason ?? 'No se puede actualizar en este momento.' })
      modalOpen.value = true
      return
    }

    const loaded = await loadPlugin()
    if (!loaded) return
    const plugin = loaded.plugin

    const permission = await plugin.canInstallPackages()
    if (!permission.allowed) {
      await openInstallPermission(plugin)
      return
    }

    setState({ needsPermission: false })
    const result = await plugin.install({ path: pending.path })
    if (!result.launched) {
      setState({ error: 'No se pudo abrir el instalador del sistema.' })
      return
    }

    // A partir de aquí la app puede morir en cualquier momento: el resultado
    // real se resuelve al volver al foreground comparando versionCode.
    awaitingVersionCode = pending.versionCode
    setState({ stage: 'installing' })
    modalOpen.value = true
  } catch (error) {
    if (errorCode(error) === 'install_permission_required') {
      const retry = await loadPlugin()
      if (retry) {
        await openInstallPermission(retry.plugin)
        return
      }
    }
    setState({ stage: 'ready', error: 'No se pudo instalar la actualización.' })
  } finally {
    busyGuard.value = false
  }
}

/**
 * Resuelve la instalación lanzada: se llama al volver al foreground. El
 * ActivityResult no sirve (muchos OEM devuelven RESULT_CANCELED siempre).
 */
async function resolvePendingInstall(): Promise<void> {
  if (awaitingVersionCode <= 0) return
  const target = awaitingVersionCode
  const loaded = await loadPlugin()
  if (!loaded) return
  const plugin = loaded.plugin

  const installed = await plugin.getInstalledInfo()
  awaitingVersionCode = 0

  if (installed.versionCode >= target) {
    // Éxito: el APK ya no sirve para nada y ocupa decenas de MB.
    await plugin.clearDownloads().catch(() => undefined)
    savePending(null)
    setState({
      stage: 'idle',
      progress: 0,
      versionCode: installed.versionCode,
      versionName: installed.versionName,
      installable: false,
      needsPermission: false,
      error: '',
    })
    // NO se marca el throttle: aquí no se consultó el manifiesto.
    return
  }

  // El usuario canceló (o el instalador nunca arrancó). El APK ya está
  // descargado y verificado, así que se CONSERVA: borrar el rastro obligaría a
  // volver a bajar los MB a los 15 min y a insistir con el mismo aviso en cada
  // foreground del día. Se aplaza por `versionCode`, de modo que una versión
  // nueva sí se anuncia.
  deferredVersionCode.value = target
  writeNumber(deferKey(target), Date.now())
  setState({
    stage: 'ready',
    progress: 100,
    installable: true,
    needsPermission: false,
    error: '',
  })
}

// --- Ciclo de vida -----------------------------------------------------------

/** Timer del chequeo periódico (recursivo, no setInterval: admite jitter). */
let recheckTimer: number | null = null

/**
 * Re-arma el chequeo con jitter fresco.
 *
 * Por qué un timer y no sólo `visibilitychange`: en un POS el WebView puede
 * quedarse visible horas (pantalla encendida, app en primer plano). Sin timer,
 * una versión publicada a media mañana no se vería hasta el día siguiente.
 */
function scheduleNext(): void {
  if (recheckTimer !== null) window.clearTimeout(recheckTimer)
  const delay = MANIFEST_THROTTLE_MS + Math.floor(Math.random() * JITTER_MAX_MS)
  recheckTimer = window.setTimeout(() => {
    const stage = currentStage()
    if (stage === 'idle' || stage === 'ready') void onForeground()
    scheduleNext()
  }, delay)
}

async function onForeground(): Promise<void> {
  if (awaitingVersionCode > 0) {
    await resolvePendingInstall()
  }
  await restoreCachedApk()
  void runCheck()
}

/**
 * Recupera el APK descargado en una sesión anterior.
 *
 * Va en `onForeground` y no dentro de `runCheck` a propósito: `runCheck` sale
 * temprano por throttle y por `navigator.onLine`, y un APK ya verificado debe
 * poder ofrecerse aunque no haya red para consultar el manifiesto.
 */
async function restoreCachedApk(): Promise<void> {
  if (pendingApk) return
  if (readString(PENDING_KEY) === '') return
  try {
    const loaded = await loadPlugin()
    if (!loaded) return
    const installed = await loaded.plugin.getInstalledInfo()
    await hydratePending(loaded.plugin, installed.versionCode)
  } catch {
    // Sin plugin o sin storage: el updater simplemente no recuerda nada.
  }
}

function onVisibilityChange(): void {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  void onForeground()
}

/** Timer del evento `online` (debounce: un parpadeo de red no dispara nada). */
let onlineTimer: number | null = null

/**
 * Recuperar red: re-chequear sin esperar al timer.
 *
 * Sin esto, un teléfono que arrancó sin datos y los recupera a media mañana
 * esperaría hasta 20 min (throttle + jitter) para ver el aviso.
 */
function onOnline(): void {
  if (onlineTimer !== null) window.clearTimeout(onlineTimer)
  onlineTimer = window.setTimeout(() => {
    onlineTimer = null
    const stage = currentStage()
    if (stage !== 'idle' && stage !== 'ready') return
    void onForeground()
    scheduleNext()
  }, ONLINE_DEBOUNCE_MS)
}

/**
 * Arranca el watcher (idempotente). No-op fuera de Android. Llamar desde
 * App.vue onMounted SIN await: no debe retrasar el render.
 */
export function startAndroidUpdateWatcher(): void {
  if (started) return
  if (getPlatform() !== 'Android') return
  started = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)
  window.setTimeout(() => {
    void onForeground()
    scheduleNext()
  }, INITIAL_DELAY_MS)
}

/**
 * Chequeo manual (sección de Ajustes). Ignora el throttle pero respeta un APK
 * ya descargado.
 */
export async function checkAndroidUpdatesNow(): Promise<AndroidUpdateStage> {
  if (getPlatform() !== 'Android') return 'idle'
  if (currentStage() === 'ready') {
    modalOpen.value = true
    return 'ready'
  }
  writeNumber(LAST_CHECK_KEY, 0)
  await runCheck()
  return currentStage()
}
