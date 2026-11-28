/**
 * TekLive Rest · Acceso directo Android con el logo de la empresa.
 *
 * El ÍCONO DE LA APP es estático y va empaquetado en el APK con la marca del
 * cliente (alita de Crazzy Wings, ver android/app/src/main/res/mipmap-*) porque
 * el sistema se vende a una sola empresa. Android no permite apuntar el ícono
 * del launcher a un archivo descargado, así que la única vía para mostrar el
 * logo de la empresa es un ACCESO DIRECTO adicional en la pantalla de inicio
 * (`RestIconPlugin`); ese shortcut no reemplaza al ícono de la app.
 *
 * Fuera de Android todo es no-op (devuelve valores neutros), igual que
 * update-android.ts: el mismo bundle corre en web y desktop.
 */

import { logoPath } from './company-logo'
import { getPlatform } from './device'

interface RestIconHandle {
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
