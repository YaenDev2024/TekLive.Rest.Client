/**
 * TekLive Rest · Plataforma de ejecución.
 *
 * Tauri (desktop Windows) y Capacitor (APK Android) inyectan objetos globales
 * distintos en el WebView; la PWA servida por nginx no inyecta ninguno.
 *
 * La detección NO importa paquetes nativos: sólo mira el global. Así el mismo
 * bundle funciona en las tres plataformas y `npm run build` nunca depende de
 * que @capacitor/core esté presente.
 */

import { isTauri } from './printing/tauri-bridge'

export type RuntimePlatform = 'Desktop' | 'Android' | 'Web'

/** true dentro de un APK Android con el puente de Capacitor listo. */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  try {
    return cap?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/**
 * Se consulta en cada uso y no al importar el módulo: el shell puede cargarse
 * antes de que el WebView termine de inyectar el puente.
 */
export function getPlatform(): RuntimePlatform {
  if (typeof window === 'undefined') return 'Web'
  if (isTauri()) return 'Desktop'
  if (isCapacitorNative()) return 'Android'
  return 'Web'
}
