/**
 * TekLive Rest · Logo de empresa (web, desktop y APK).
 *
 * Una sola fuente para las tres plataformas:
 * - GET /api/public/company-logo/{companyId} → bytes WebP del logo APROBADO
 *   (anónimo, 404 mientras no esté aprobado).
 * - POST /api/rest/company/logo (multipart "file") → sube y deja 'pending'.
 * - GET /api/rest/company/logo/status → estado de la revisión.
 *
 * El mismo binario alimenta el favicon de la web, el ícono de la ventana y los
 * accesos directos del desktop, y el ícono del APK (ver window-icon.ts).
 *
 * Base absoluta en desktop/APK: el origen del WebView es tauri://localhost o
 * https://localhost, así que una ruta relativa /api/... no resuelve ahí.
 */

import { computed, ref, type Ref } from 'vue'

/**
 * Base del API para URLs de RECURSOS (<img src>, favicon) que NO pasan por el
 * cliente HTTP: en web es '' (mismo origen, sin CORS); en desktop/APK debe ser
 * la base absoluta que el build grabó en VITE_API_BASE_URL.
 */
function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
}

/**
 * Contador de cache-busting: se incrementa tras subir un logo para que el
 * navegador/WebView no siga mostrando el anterior desde su caché.
 */
export const logoCacheVersion = ref(0)

/** Ruta relativa/absoluta del logo de la empresa ('' si no hay companyId). */
export function logoPath(companyId: number | null): string {
  if (companyId == null || companyId <= 0) return ''
  const base = `${apiBase()}/api/public/company-logo/${companyId}`
  const version = logoCacheVersion.value
  return version ? `${base}?v=${version}` : base
}

/** Fuerza la recarga del logo en todos los puntos que lo usan. */
export function bustLogoCache(): void {
  logoCacheVersion.value = Date.now()
}

/**
 * URL del logo con dependencia reactiva.
 *
 * Se usa en el template: si `companyId` cambia (login/logout) o se sube un logo
 * nuevo, la `<img>` se repinta sin tocar la vista.
 */
export function useCompanyLogo(companyId: Ref<number | null> | (() => number | null)) {
  const src = computed(() => {
    void logoCacheVersion.value
    const id = typeof companyId === 'function' ? companyId() : companyId.value
    return logoPath(id)
  })
  return { src, bustLogoCache, logoCacheVersion }
}

/**
 * Aplica el logo de la empresa como favicon de la pestaña.
 *
 * En web el favicon apunta al endpoint público; si aún no hay logo aprobado el
 * 404 hace que el navegador conserve el anterior (comportamiento nativo, no
 * hace falta un <img> de sondeo). Sin companyId se restaura el de TekLive.
 *
 * Nota: el ícono del launcher del APK NO se puede cambiar en caliente — Android
 * lo toma de los recursos `mipmap` del paquete, así que en el teléfono el logo
 * de la empresa aplica dentro de la app (no en la pantalla de inicio).
 */
export function setFavicon(companyId: number | null): void {
  if (typeof document === 'undefined') return
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  const path = logoPath(companyId)
  link.href = path || '/favicon.svg'
}
