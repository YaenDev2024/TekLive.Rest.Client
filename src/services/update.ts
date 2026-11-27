/**
 * TekLive Rest · Auto-update desktop (Tauri updater + process).
 *
 * Mismo flujo que TekLive Abogados:
 * 1. Al arrancar (y cada 15 min / 4 h): check() contra el endpoint del updater.
 * 2. Si hay versión nueva -> descarga automática en background con progreso
 *    (barra en el rail). El usuario sigue vendiendo normal.
 * 3. Al terminar: modal "Actualizar ahora" / "Más tarde".
 *    - "Más tarde": esconde el modal 24 h (máx). El indicador del rail queda
 *      visible con botón manual.
 *    - A las 24 h el modal reaparece SIN "Más tarde" (obligatorio).
 *    - Si la versión instalada está 2+ patches atrás: obligatorio inmediato.
 * 4. Instalar = install() (ya descargado) + relaunch. NSIS passive.
 *
 * Best-effort total: cualquier error (sin red, endpoint caído, firma) es
 * silencioso — la app funciona igual. Web/APK: no-op (el APK tiene su propio
 * servicio, update-android.ts).
 */

import { readonly, ref } from 'vue'
import { getPlatform } from './device'
import { canInstallNow } from './update-guard'

export type UpdateStage = 'idle' | 'downloading' | 'ready' | 'installing'

export interface UpdateState {
  stage: UpdateStage
  /** 0-100 durante downloading. */
  progress: number
  /** Versión disponible (p. ej. "0.4.0"). */
  version: string
  /** Notas de la versión (si el server las manda). */
  notes: string
  /** true cuando "Más tarde" no es opción (versión muy vieja o 24 h vencidas). */
  mandatory: boolean
  /** Error humano si algo falló (no se muestra salvo debug). */
  error: string
}

const state = ref<UpdateState>({
  stage: 'idle',
  progress: 0,
  version: '',
  notes: '',
  mandatory: false,
  error: '',
})

export const updateState = readonly(state)

/** Guard de instalación en curso (evita dos instalaciones en paralelo). */
const busy = ref(false)
export const updateBusy = readonly(busy)

/** Cada cuánto re-chequear (ms). */
const RECHECK_MS = 4 * 60 * 60 * 1000
/** Primer re-chequeo tras montar (ms): detectar releases sin recargar. */
const FIRST_RECHECK_MS = 60 * 1000
/** Re-chequeo periódico mientras la app siga abierta (ms). */
const ACTIVE_RECHECK_MS = 15 * 60 * 1000
/** Cuánto puede aplazar el cliente la actualización. */
const DEFER_MAX_MS = 24 * 60 * 60 * 1000
/** Clave de persistencia del aplazamiento (por versión). */
const DEFER_KEY_PREFIX = 'teklive_rest_update_deferred_'
/** Cuántos patches de retraso se toleran antes de forzar. */
const MAX_LAG_PATCHES = 1
/** Tick para detectar vencimiento del aplazamiento (ms). */
const DEFER_TICK_MS = 30 * 1000

let started = false
let pendingUpdate: UpdaterUpdate | null = null
/** Deadline del aplazamiento (epoch ms); 0 = sin aplazar. Reactivo. */
const deferredUntil = ref(0)
/** El usuario reabrió el modal desde el indicador. */
const modalOpen = ref(false)
let deferTimer: number | null = null

function setState(patch: Partial<UpdateState>): void {
  state.value = { ...state.value, ...patch }
}

function isDesktop(): boolean {
  return getPlatform() === 'Desktop'
}

// --- Semver (sin librería) ---------------------------------------------------

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** true si current está demasiado atrás de next (2+ patches o minor/major). */
function isTooFarBehind(current: string, next: string): boolean {
  const c = parseSemver(current)
  const n = parseSemver(next)
  if (!c || !n) return false
  if (n[0] !== c[0] || n[1] !== c[1]) return true
  return n[2] - c[2] > MAX_LAG_PATCHES
}

// --- Aplazamiento (24 h, una sola vez por versión) ---------------------------

function deferKey(version: string): string {
  return DEFER_KEY_PREFIX + version
}

function loadDeferDeadline(version: string): number {
  try {
    const raw = localStorage.getItem(deferKey(version))
    if (!raw) return 0
    const until = Number(raw)
    return Number.isFinite(until) && until > Date.now() ? until : 0
  } catch {
    return 0
  }
}

function persistDefer(version: string, until: number): void {
  try {
    localStorage.setItem(deferKey(version), String(until))
  } catch {
    // Sin storage: el flag en memoria cubre la sesión.
  }
}

/** ¿El usuario ya aplazó esta versión (aunque hayan vencido las 24 h)? */
function hasDeferred(version: string): boolean {
  if (deferredUntil.value > 0) return true
  try {
    return localStorage.getItem(deferKey(version)) !== null
  } catch {
    return false
  }
}

/** El usuario eligió "Más tarde". */
export function deferUpdate(): void {
  const v = state.value.version
  if (!v) return
  const until = Date.now() + DEFER_MAX_MS
  deferredUntil.value = until
  persistDefer(v, until)
  modalOpen.value = false
  armDeferTimer()
}

/** Timer que vence el aplazamiento y re-muestra el modal (obligatorio). */
function armDeferTimer(): void {
  if (deferTimer !== null) window.clearInterval(deferTimer)
  deferTimer = window.setInterval(() => {
    if (deferredUntil.value > 0 && Date.now() >= deferredUntil.value) {
      // Nuevo objeto => el readonly ref notifica y el modal reaparece.
      deferredUntil.value = 0
      state.value = { ...state.value, mandatory: true }
    }
  }, DEFER_TICK_MS)
}

/** ¿Puede el usuario elegir "Más tarde"? Solo una vez y si no es forzoso. */
export function canDefer(): boolean {
  if (state.value.stage !== 'ready') return false
  if (state.value.mandatory) return false
  return !hasDeferred(state.value.version)
}

export function isUpdateDeferred(): boolean {
  return deferredUntil.value > 0
}

/** ¿Debe mostrarse el modal? (descarga lista y no está aplazado vigente). */
export function shouldShowModal(): boolean {
  const stage = state.value.stage
  if (stage !== 'ready' && stage !== 'installing') return false
  if (modalOpen.value) return true
  return deferredUntil.value === 0
}

/** El usuario abrió el detalle desde el indicador (ignora el aplazamiento). */
export function openUpdateModal(): void {
  if (state.value.stage !== 'ready' && state.value.stage !== 'installing') return
  modalOpen.value = true
}

export function closeUpdateModal(): void {
  modalOpen.value = false
}

export function isUpdateModalPinned(): boolean {
  return modalOpen.value
}

// --- Instalación -------------------------------------------------------------

/**
 * Instala (ya descargado) y relanza. La app se cierra al instalar.
 *
 * Antes exige el guard: el carrito vive en memoria y una venta a medio capturar
 * se perdería. Si el guard bloquea, el estado pasa a 'ready' con el motivo en
 * `error` y el modal lo muestra.
 */
export async function installUpdate(): Promise<void> {
  if (!pendingUpdate || state.value.stage !== 'ready') return
  if (busy.value) return

  busy.value = true
  try {
    const guard = await canInstallNow()
    if (!guard.ok) {
      setState({ error: guard.reason ?? 'No se puede actualizar en este momento.' })
      modalOpen.value = true
      return
    }

    setState({ stage: 'installing', error: '' })
    await pendingUpdate.install()
    // En Windows install() suele terminar el proceso; si vuelve, relanzamos.
    try {
      const proc = await import('@tauri-apps/plugin-process')
      await proc.relaunch()
    } catch {
      // Si relaunch falla tras install, el usuario abre la app manualmente.
    }
  } catch (e) {
    setState({ stage: 'ready', error: String(e) })
    throw e
  } finally {
    busy.value = false
  }
}

// --- Check + descarga --------------------------------------------------------

interface UpdaterUpdate {
  version: string
  body?: string
  currentVersion?: string
  date?: string
  install(): Promise<void>
  // Firma real del plugin-updater 2.x: download con (onEvent?, options?).
  // Se declara loose para no pelear con el runtime.
  download(
    onEvent?: (e: { event: string; data?: unknown }) => void,
    options?: { headers?: Record<string, string> }
  ): Promise<void>
}

/**
 * Headers del updater.
 *
 * /api/rest/desktop/updates/latest.json está EXENTO de X-Api-Key (un cliente
 * con licencia vencida también debe poder actualizarse), pero se envía si está
 * configurada: el día que el endpoint pida la llave, no hay que tocar código.
 */
function updaterHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_APP_API_KEY as string | undefined
  return key ? { 'X-Api-Key': key } : {}
}

async function checkAndDownload(): Promise<void> {
  if (!isDesktop()) return
  if (state.value.stage === 'downloading' || state.value.stage === 'installing') {
    return
  }
  try {
    const updater = await import('@tauri-apps/plugin-updater')
    const update = (await updater.check({
      headers: updaterHeaders(),
    })) as UpdaterUpdate | null
    if (!update) return
    // Misma versión ya descargada y pendiente: no re-descargar.
    if (
      pendingUpdate &&
      state.value.stage === 'ready' &&
      update.version === state.value.version
    ) {
      return
    }
    pendingUpdate = update
    const current = update.currentVersion || ''
    const mandatory =
      isTooFarBehind(current, update.version) || hasDeferred(update.version)
    // Restaurar aplazamiento vigente de una sesión anterior.
    const saved = loadDeferDeadline(update.version)
    deferredUntil.value = saved
    if (saved > 0) armDeferTimer()
    setState({
      stage: 'downloading',
      progress: 0,
      version: update.version,
      notes: typeof update.body === 'string' ? update.body : '',
      mandatory,
      error: '',
    })
    // Descarga silenciosa con progreso (mismo X-Api-Key).
    let contentLength = 0
    let downloaded = 0
    await update.download(
      (event) => {
        switch (event.event) {
          case 'Started':
            contentLength = Number(
              (event.data as { contentLength?: number } | undefined)?.contentLength ?? 0,
            )
            break
          case 'Progress': {
            downloaded += Number(
              (event.data as { chunkLength?: number } | undefined)?.chunkLength ?? 0,
            )
            if (contentLength > 0) {
              setState({
                progress: Math.min(99, Math.round((downloaded / contentLength) * 100)),
              })
            }
            break
          }
          case 'Finished':
            setState({ progress: 100 })
            break
        }
      },
      { headers: updaterHeaders() },
    )
    setState({ stage: 'ready' })
  } catch {
    // Silencioso: sin red / endpoint caído / firma inválida. Volver a idle
    // salvo que ya hubiera una versión 'ready' pendiente de instalar.
    if (state.value.stage !== 'ready') {
      setState({ stage: 'idle', progress: 0 })
    }
  }
}

/**
 * Arranca el ciclo de update (idempotente). Llamar en App.vue onMounted.
 *
 * Detección sin refresh: el check inicial corre al montar; a los 60 s se
 * re-chequea (cubre el release publicado justo después de abrir la app) y luego
 * cada 15 min. El intervalo de 4 h queda como red de seguridad.
 */
export function startUpdateWatcher(): void {
  if (started || !isDesktop()) return
  started = true
  void checkAndDownload()
  window.setTimeout(() => {
    if (state.value.stage === 'idle' || state.value.stage === 'ready') {
      void checkAndDownload()
    }
  }, FIRST_RECHECK_MS)
  window.setInterval(() => {
    if (state.value.stage === 'idle' || state.value.stage === 'ready') {
      void checkAndDownload()
    }
  }, ACTIVE_RECHECK_MS)
  window.setInterval(() => {
    if (state.value.stage === 'idle' || state.value.stage === 'ready') {
      void checkAndDownload()
    }
  }, RECHECK_MS)
}

/** Check manual (botón "Buscar actualizaciones" en Ajustes). */
export async function checkForUpdatesNow(): Promise<'updated' | 'downloading' | 'ready'> {
  if (!isDesktop()) return 'updated'
  const before = state.value.stage
  if (before === 'ready') return 'ready'
  if (before === 'downloading') return 'downloading'
  await checkAndDownload()
  const after = state.value.stage
  if (after === 'ready') return 'ready'
  if (after === 'downloading') return 'downloading'
  return 'updated'
}

/**
 * Versión instalada del binario, leída de la propia app de Tauri.
 *
 * En Windows no hay forma de preguntarle al instalador sin tocar el registro.
 * `getVersion()` del core devuelve la versión con la que se empaquetó ESTE
 * ejecutable, que es la que compara el updater: es la cifra que el operador
 * necesita ver para entender por qué no le aparece el aviso. `null` si no corre
 * en desktop o si el puente no responde.
 */
export async function readInstalledVersion(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const app = await import('@tauri-apps/api/app')
    const version = await app.getVersion()
    return typeof version === 'string' && version.trim() ? version.trim() : null
  } catch {
    return null
  }
}
