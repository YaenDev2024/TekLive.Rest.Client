/**
 * TekLive Rest · Auth/session service.
 *
 * Persistence policy (ajustada 2026-11-14 — petición del dueño: F5 no saca
 * al login):
 * - accessToken: IN MEMORY ONLY (15 min, corto a propósito).
 * - refreshToken: localStorage (rest.refreshToken) → tras un reload el
 *   router guard rota silenciosamente contra POST /auth/refresh y la
 *   sesión continúa sin re-login. Logout lo borra. En Tauri/Android fases
 *   futuras migrará al secure store de la plataforma.
 * - localStorage además guarda perfil no-sensible: rest.employeeNumber,
 *   rest.displayName, rest.role, rest.deviceId.
 *
 * Company resolution is 100% SERVER-SIDE: the backend deduces the company
 * from the globally-unique employee number at login. The client never stores
 * a companyId (the authenticated user's companyId is available in the login
 * response and /me when a view needs it, in memory only).
 */

import { reactive } from 'vue'
import { getAccessToken, setAccessToken } from '../api/client'
import { clearProductImages } from '../api/productImages'
import { getMe } from '../api/rest'

const LS_EMPLOYEE_NUMBER = 'rest.employeeNumber'
const LS_DISPLAY_NAME = 'rest.displayName'
const LS_ROLE = 'rest.role'
const LS_DEVICE_ID = 'rest.deviceId'
/**
 * Refresh token persistido (2026-11-14, petición del dueño: F5 no debe
 * sacar al login). El ACCESS token sigue memory-only (15 min, corto a
 * propósito); el REFRESH viaja en localStorage y permite resume silencioso
 * tras reload vía POST /auth/refresh (rotación + anti-reuso del backend:
 * presentar un refresh ya usado revoca la familia, así que SIEMPRE se
 * sobrescribe con el nuevo tras cada rotación). Logout lo borra.
 */
const LS_REFRESH_TOKEN = 'rest.refreshToken'

/**
 * Legacy keys from the old license-activation flow. The backend no longer
 * needs them (company is deduced from the employee number), so they are
 * removed once at module load to avoid stale garbage. Device/profile keys
 * above are untouched.
 */
const LEGACY_LS_KEYS = ['rest.companyId', 'rest.licenseKey'] as const

for (const key of LEGACY_LS_KEYS) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage unavailable (private mode): nothing to clean either.
  }
}

/** In-memory session state (reactive for Vue reactivity). */
export const session = reactive({
  accessToken: null as string | null,
  refreshToken: null as string | null,
  employeeNumber: null as string | null,
  displayName: null as string | null,
  role: null as string | null,
  deviceId: null as string | null,
  /**
   * Empresa del usuario autenticado, SOLO en memoria y siempre resuelta por el
   * servidor (/me o login). NUNCA se persiste ni se envía: la usa únicamente el
   * logo de empresa (favicon/ícono de ventana).
   */
  companyId: null as number | null,
})

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode): session still works in memory.
  }
}

/** One-time device id (crypto.randomUUID) persisted for DEVICE_SESSION REBIND. */
export function getDeviceId(): string {
  if (session.deviceId != null) return session.deviceId
  const existing = readLS(LS_DEVICE_ID)
  if (existing != null && existing.length > 0) {
    session.deviceId = existing
    return existing
  }
  const generated =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  session.deviceId = generated
  writeLS(LS_DEVICE_ID, generated)
  return generated
}

/** Persist the non-sensitive profile after a successful login. */
export function persistSession(profile: {
  employeeNumber: string | null
  displayName: string | null
  role: string | null
}): void {
  if (profile.employeeNumber != null) {
    session.employeeNumber = profile.employeeNumber
    writeLS(LS_EMPLOYEE_NUMBER, profile.employeeNumber)
  }
  if (profile.displayName != null) {
    session.displayName = profile.displayName
    writeLS(LS_DISPLAY_NAME, profile.displayName)
  }
  if (profile.role != null) {
    session.role = profile.role
    writeLS(LS_ROLE, profile.role)
  }
}

/**
 * Called right after a successful login: keeps the access token in memory
 * and syncs the module state with the API client wrapper. The refresh token
 * se persiste para sobrevivir recargas (resume silencioso tras F5).
 */
export function applyTokens(accessToken: string, refreshToken: string | null): void {
  session.accessToken = accessToken
  session.refreshToken = refreshToken
  setAccessToken(accessToken)
  // Persistir el refresh ACTUAL (login emite uno nuevo; si es null se
  // conserva el previo — applyTokens(null) nunca borra un refresh vivo).
  if (refreshToken != null) writeLS(LS_REFRESH_TOKEN, refreshToken)
}

/** Refresh silencioso exitoso: sincroniza ambos tokens (memoria). */
export function applyRefreshedTokens(accessToken: string, refreshToken: string): void {
  applyTokens(accessToken, refreshToken)
}

/** Refresh token actual (memoria; fallback al persistido tras un reload). */
export function getRefreshToken(): string | null {
  if (session.refreshToken != null) return session.refreshToken
  // Tras un F5 la memoria está vacía: leer el persistido (el resume lo
  // promueve a memoria al rotar; mientras tanto el 401-handler lo usa).
  const persisted = readLS(LS_REFRESH_TOKEN)
  if (persisted != null) session.refreshToken = persisted
  return persisted
}

/**
 * Resume silencioso tras recarga (F5): rota el refresh persistido contra
 * POST /auth/refresh para obtener un access token nuevo SIN re-login.
 * El guard del router lo invoca cuando no hay token en memoria. Single-
 * flight vía el mismo refreshInFlight del client (se llama con el import
 * circular resuelto por inyección: el router pasa el rotador).
 */
export async function tryResumeFromPersistedRefresh(
  rotate: (refreshToken: string) => Promise<boolean>,
): Promise<boolean> {
  if (getAccessToken() != null) return true // ya hay sesión viva en memoria
  const persisted = getRefreshToken()
  if (persisted == null || persisted.length === 0) return false
  const ok = await rotate(persisted)
  if (!ok) {
    // Refresh inválido/usado/expirado: limpiar para no reintentar en cada
    // navegación (el perfil no-sensible sobrevive para el prefill).
    writeLS(LS_REFRESH_TOKEN, null)
    session.refreshToken = null
  }
  return ok
}

/**
 * Restore the persisted profile (no tokens — those are memory-only):
 * employee identity for prefilling the login form after a reload.
 * Always returns true: restoring is best-effort and no longer gates anything
 * (the old "device activated?" check is gone — company is server-side now).
 */
export function restoreSession(): boolean {
  session.employeeNumber = readLS(LS_EMPLOYEE_NUMBER)
  session.displayName = readLS(LS_DISPLAY_NAME)
  session.role = readLS(LS_ROLE)
  getDeviceId() // ensures deviceId is generated/persisted
  // El refresh persistido se promueve a memoria perezosamente vía
  // getRefreshToken() (primer 401) o tryResumeFromPersistedRefresh (guard).
  return true
}

/**
 * Try to resume the session with the current (memory) access token.
 * Web reload wipes memory tokens, so this normally fails on web —
 * the caller then shows the login again with prefilled employee number.
 */
export async function tryResumeSession(): Promise<boolean> {
  if (getAccessToken() == null) return false
  try {
    const { data } = await getMe()
    session.displayName = `${data.firstName} ${data.lastName}`.trim()
    session.role = data.role
    session.companyId = data.companyId ?? null
    return true
  } catch {
    return false
  }
}

/** Clear everything (logout or invalid session). */
export function clearSession(): void {
  session.accessToken = null
  session.refreshToken = null
  setAccessToken(null)
  // Los object URLs de las imágenes de producto viven en memoria toda la
  // sesión (ver api/productImages): al cerrar sesión se revocan y se olvidan
  // para no retener los blobs del usuario anterior en el POS.
  clearProductImages()
  // El refresh persistido muere con el logout explícito (si el usuario cierra
  // sesión, nadie más debe poder resumir esa sesión en este dispositivo).
  writeLS(LS_REFRESH_TOKEN, null)
  session.employeeNumber = null
  session.displayName = null
  session.role = null
  session.companyId = null
  // NOTE: deviceId survives logout intentionally: it identifies the
  // device/installation, not the employee.
}

/**
 * Nombre a mostrar en tickets ("CAJERO: X" del ticket cliente, "Atendio:" en
 * cocina): el nombre REAL del empleado logueado; 'CAJERO' solo si la sesión
 * no lo trae (fail-safe igual al valor histórico hardcodeado).
 */
export function cashierDisplayName(): string {
  const name = session.displayName?.trim()
  return name !== '' && name != null ? name : 'CAJERO'
}
