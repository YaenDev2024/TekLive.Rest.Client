/**
 * TekLive Rest · Ícono de la app Android.
 *
 * Dos capacidades distintas, expuestas por `RestIconPlugin`:
 *
 * 1. PRESETS: cambia el ícono del cajón de apps entre variantes empaquetadas en
 *    el APK (predeterminado, oscuro, claro, monocromo). Se implementa con
 *    `<activity-alias>`: el plugin habilita el alias elegido y deshabilita los
 *    demás. Android NO permite apuntar ese ícono a un archivo descargado, así
 *    que aquí no entra el logo de la empresa.
 *
 * 2. ACCESO DIRECTO CON EL LOGO: fija un shortcut en la pantalla de inicio cuyo
 *    ícono es el logo real de la empresa, bajado del endpoint público. Es la
 *    única vía para un bitmap arbitrario. Android pide confirmación al usuario y
 *    el ícono es adicional: no reemplaza al de la app.
 *
 * Fuera de Android todo es no-op (devuelve valores neutros), igual que
 * update-android.ts: el mismo bundle corre en web y desktop.
 */

import { logoPath } from './company-logo'
import { getPlatform } from './device'

export interface IconPreset {
  id: string
  label: string
}

export interface IconPresetsResult {
  presets: IconPreset[]
  current: string
}

interface RestIconHandle {
  listPresets(): Promise<IconPresetsResult>
  setPreset(options: { preset: string }): Promise<{ preset: string }>
  pinCompanyShortcut(options: { url: string; label?: string }): Promise<{ pinned: boolean }>
  removeCompanyShortcut(): Promise<{ removed: boolean }>
}

interface CapacitorCoreModule {
  registerPlugin<T>(name: string): T
}

let cachedPlugin: RestIconHandle | null = null

/**
 * Carga perezosa del plugin.
 *
 * Igual que en update-android.ts: el import va SIN anotación para que Vite
 * empaquete el chunk, y el resultado se envuelve en un objeto plano. El Proxy
 * que devuelve `registerPlugin()` responde a CUALQUIER propiedad, incluida
 * `.then`; al resolver una promesa el motor lee `.then`, lo invoca y el puente
 * contesta "RestIcon.then() is not implemented on android".
 */
async function loadPlugin(): Promise<{ plugin: RestIconHandle } | null> {
  if (getPlatform() !== 'Android') return null
  if (cachedPlugin) return { plugin: cachedPlugin }
  try {
    const core = (await import('@capacitor/core')) as CapacitorCoreModule
    cachedPlugin = core.registerPlugin<RestIconHandle>('RestIcon')
    return { plugin: cachedPlugin }
  } catch {
    return null
  }
}

/** true sólo dentro del APK Android con el plugin disponible. */
export async function isIconCustomizationAvailable(): Promise<boolean> {
  return (await loadPlugin()) !== null
}

/**
 * Presets de ícono disponibles y el activo.
 *
 * En web/desktop devuelve lista vacía: la UI esconde la sección entera.
 */
export async function listIconPresets(): Promise<IconPresetsResult | null> {
  const loaded = await loadPlugin()
  if (!loaded) return null
  try {
    const result = await loaded.plugin.listPresets()
    // El plugin devuelve `presets` como array; se valida por si una versión
    // vieja del APK no lo trae (app actualizada a medias).
    if (!result || !Array.isArray(result.presets)) return null
    return {
      presets: result.presets.filter((p) => p && typeof p.id === 'string'),
      current: typeof result.current === 'string' ? result.current : 'default',
    }
  } catch {
    return null
  }
}

/**
 * Cambia el ícono de la app al preset indicado.
 *
 * Ojo: en algunos lanzadores el cambio recrea la tarea y la app se cierra. La
 * UI debe avisar antes y no llamar esto con trabajo sin guardar.
 */
export async function setIconPreset(preset: string): Promise<boolean> {
  const loaded = await loadPlugin()
  if (!loaded) return false
  try {
    const result = await loaded.plugin.setPreset({ preset })
    return result?.preset === preset
  } catch {
    return false
  }
}

/**
 * Fija un acceso directo en la pantalla de inicio con el logo de la empresa.
 *
 * `pinned: true` significa que la petición se envió: Android muestra su propio
 * diálogo y no informa con fiabilidad si el usuario aceptó (limitación de la
 * API en versiones antiguas), así que la UI no debe prometer que quedó hecho.
 */
export async function pinCompanyShortcut(
  companyId: number | null,
  label = 'TekLive Rest',
): Promise<'pinned' | 'unavailable' | 'no-logo' | 'error'> {
  const loaded = await loadPlugin()
  if (!loaded) return 'unavailable'

  const url = logoPath(companyId)
  if (!url) return 'no-logo'

  // logPath puede ser relativa en web; el plugin necesita una URL absoluta.
  // En Android la base ya viene absoluta de VITE_API_BASE_URL.
  let absolute: string
  try {
    absolute = new URL(url, window.location.origin).toString()
  } catch {
    return 'error'
  }
  if (!/^https?:/i.test(absolute)) return 'no-logo'

  try {
    const result = await loaded.plugin.pinCompanyShortcut({ url: absolute, label })
    return result?.pinned ? 'pinned' : 'error'
  } catch {
    return 'error'
  }
}

/** Quita el acceso directo con el logo de la empresa. */
export async function removeCompanyShortcut(): Promise<boolean> {
  const loaded = await loadPlugin()
  if (!loaded) return false
  try {
    const result = await loaded.plugin.removeCompanyShortcut()
    return result?.removed === true
  } catch {
    return false
  }
}
