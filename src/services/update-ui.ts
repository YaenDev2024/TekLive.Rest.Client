/**
 * TekLive Rest · Vista unificada del updater (desktop + Android).
 *
 * Por qué existe: UpdateIndicator/UpdateModal son los mismos componentes en
 * ambas plataformas. Duplicarlos sería garantizar que un arreglo de copy o de
 * accesibilidad se aplique sólo a una. Aquí se normaliza el estado de los dos
 * servicios a una forma común y se enrutan las acciones al que corresponda, de
 * modo que los componentes no necesitan saber en qué plataforma corren.
 *
 * Regla: sólo hay un updater activo por plataforma (desktop -> update.ts,
 * Android -> update-android.ts); el otro está en 'idle' de forma permanente.
 */

import { computed } from 'vue'
import { getPlatform } from './device'
import {
  canDefer,
  closeUpdateModal,
  deferUpdate,
  installUpdate,
  isUpdateDeferred,
  isUpdateModalPinned,
  openUpdateModal,
  shouldShowModal,
  startUpdateWatcher,
  updateBusy,
  updateState,
} from './update'
import {
  androidUpdateBusy,
  androidUpdateState,
  canDeferAndroid,
  closeAndroidUpdateModal,
  deferAndroidUpdate,
  installAndroidUpdate,
  isAndroidUpdateDeferred,
  isAndroidUpdateModalPinned,
  openAndroidUpdateModal,
  pauseAndroidUpdateModalAutoShow,
  shouldShowAndroidModal,
  startAndroidUpdateWatcher,
} from './update-android'

export type UpdateViewStage = 'idle' | 'downloading' | 'ready' | 'installing'
export type UpdateViewPlatform = 'Desktop' | 'Android'

export interface UpdateViewState {
  /** Plataforma cuyo updater está en uso (Desktop o Android; nunca Web). */
  platform: UpdateViewPlatform
  stage: UpdateViewStage
  progress: number
  /** Versión a mostrar. */
  version: string
  notes: string
  /** Motivo humano por el que no se pudo descargar/instalar. */
  error: string
  /**
   * false cuando el APK existe pero no se puede instalar (firma distinta, no
   * es más nuevo). En desktop siempre es true con stage 'ready'.
   */
  installable: boolean
  /** Android: falta autorizar "instalar apps desconocidas". */
  needsPermission: boolean
  deferred: boolean
}

/**
 * `getPlatform()` se consulta en cada lectura, no al importar el módulo: el
 * shell puede importarse antes de que el WebView inyecte el puente.
 */
function isAndroid(): boolean {
  return getPlatform() === 'Android'
}

/**
 * Estado combinado (sólo lectura). En Web no hay updater: la vista se queda en
 * 'idle' y los componentes no pintan nada.
 */
export const updateView = computed<UpdateViewState>(() => {
  if (isAndroid()) {
    const s = androidUpdateState.value
    return {
      platform: 'Android',
      stage: s.stage,
      progress: s.progress,
      version: s.versionName || (s.versionCode > 0 ? String(s.versionCode) : ''),
      notes: s.notes,
      error: s.error,
      installable: s.installable,
      needsPermission: s.needsPermission,
      deferred: isAndroidUpdateDeferred(),
    }
  }

  const s = updateState.value
  return {
    platform: 'Desktop',
    stage: s.stage,
    progress: s.progress,
    version: s.version,
    notes: s.notes,
    error: s.error,
    installable: true,
    needsPermission: false,
    deferred: isUpdateDeferred(),
  }
})

/** Guard de instalación en curso (en ambas plataformas). */
export const updateViewBusy = computed(() =>
  isAndroid() ? androidUpdateBusy.value : updateBusy.value
)

export function canDeferUpdate(): boolean {
  return isAndroid() ? canDeferAndroid() : canDefer()
}

export function shouldShowUpdateModal(): boolean {
  return isAndroid() ? shouldShowAndroidModal() : shouldShowModal()
}

export function isUpdateModalPinnedByUser(): boolean {
  return isAndroid() ? isAndroidUpdateModalPinned() : isUpdateModalPinned()
}

/** El shell la activa mientras el usuario está en la pantalla de venta. */
export function pauseUpdateAutoShow(paused: boolean): void {
  if (isAndroid()) {
    pauseAndroidUpdateModalAutoShow(paused)
    return
  }
  // Desktop no interrumpe el POS con el modal: el aviso vive en el indicador
  // del rail. No hay nada que pausar.
}

export function openUpdateDetails(): void {
  if (isAndroid()) {
    openAndroidUpdateModal()
    return
  }
  openUpdateModal()
}

export function closeUpdateDetails(): void {
  if (isAndroid()) {
    closeAndroidUpdateModal()
    return
  }
  closeUpdateModal()
}

/** "Más tarde". */
export function deferAnyUpdate(): void {
  if (isAndroid()) {
    deferAndroidUpdate()
    return
  }
  deferUpdate()
}

/**
 * Instala con el guard de carrito. No relanza la app aquí:
 * - Desktop: install() del plugin NSIS termina el proceso; si vuelve, relaunch.
 * - Android: el instalador del sistema sustituye la app y el SO mata el
 *   proceso. El éxito se confirma al volver al foreground (versionCode).
 */
export async function installAnyUpdate(): Promise<void> {
  if (isAndroid()) {
    await installAndroidUpdate()
    return
  }
  await installUpdate()
}

/**
 * Arranca el watcher de la plataforma. Ambos son idempotentes y no-op fuera de
 * su plataforma, así que se llaman los dos sin comprobar nada: evita que un
 * orden de importación (puente de Capacitor aún no inyectado) desactive el
 * updater por error.
 */
export function startAnyUpdateWatcher(): void {
  startUpdateWatcher()
  startAndroidUpdateWatcher()
}
