/**
 * TekLive Rest · Auth/session service.
 *
 * Persistence policy (Fase 2, plan v2):
 * - accessToken + refreshToken: IN MEMORY ONLY (module state), never
 *   localStorage on web. On Tauri/Android (later phases) the refresh token
 *   moves to the platform secure store.
 * - localStorage holds ONLY non-sensitive profile + device data:
 *   rest.employeeNumber, rest.displayName, rest.role, rest.deviceId.
 *
 * Company resolution is 100% SERVER-SIDE: the backend deduces the company
 * from the globally-unique employee number at login. The client never stores
 * a companyId (the authenticated user's companyId is available in the login
 * response and /me when a view needs it, in memory only).
 */

import { reactive } from 'vue'
import { getAccessToken, setAccessToken } from '../api/client'
import { getMe } from '../api/rest'

const LS_EMPLOYEE_NUMBER = 'rest.employeeNumber'
const LS_DISPLAY_NAME = 'rest.displayName'
const LS_ROLE = 'rest.role'
const LS_DEVICE_ID = 'rest.deviceId'

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
 * Called right after a successful login: keeps tokens in memory only
 * and syncs the module state with the API client wrapper.
 */
export function applyTokens(accessToken: string, refreshToken: string | null): void {
  session.accessToken = accessToken
  session.refreshToken = refreshToken
  setAccessToken(accessToken)
}

/** Refresh silencioso exitoso: sincroniza ambos tokens (memoria). */
export function applyRefreshedTokens(accessToken: string, refreshToken: string): void {
  applyTokens(accessToken, refreshToken)
}

/** Refresh token actual (memoria). Lo usa client.ts para la rotación en 401. */
export function getRefreshToken(): string | null {
  return session.refreshToken
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
  session.employeeNumber = null
  session.displayName = null
  session.role = null
  // NOTE: deviceId survives logout intentionally: it identifies the
  // device/installation, not the employee.
}
