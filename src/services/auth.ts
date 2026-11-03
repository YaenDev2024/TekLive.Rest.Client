/**
 * TekLive Rest · Auth/session service.
 *
 * Persistence policy (Fase 2, plan v2):
 * - accessToken + refreshToken: IN MEMORY ONLY (module state), never
 *   localStorage on web. On Tauri/Android (later phases) the refresh token
 *   moves to the platform secure store.
 * - localStorage holds ONLY non-sensitive profile + device data:
 *   rest.companyId, rest.employeeNumber, rest.displayName, rest.role,
 *   rest.deviceId, rest.licenseKey (for re-activation on boot).
 */

import { reactive } from 'vue'
import { getAccessToken, setAccessToken } from '../api/client'
import { getMe } from '../api/rest'

const LS_COMPANY_ID = 'rest.companyId'
const LS_EMPLOYEE_NUMBER = 'rest.employeeNumber'
const LS_DISPLAY_NAME = 'rest.displayName'
const LS_ROLE = 'rest.role'
const LS_DEVICE_ID = 'rest.deviceId'
const LS_LICENSE_KEY = 'rest.licenseKey'

/** In-memory session state (reactive for Vue reactivity). */
export const session = reactive({
  accessToken: null as string | null,
  refreshToken: null as string | null,
  companyId: null as number | null,
  employeeNumber: null as string | null,
  displayName: null as string | null,
  role: null as string | null,
  deviceId: null as string | null,
  licenseKey: null as string | null,
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
  companyId: number | null
  employeeNumber: string | null
  displayName: string | null
  role: string | null
}): void {
  if (profile.companyId != null) {
    session.companyId = profile.companyId
    writeLS(LS_COMPANY_ID, String(profile.companyId))
  }
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

/** Store the license key used for activation (re-activation on boot). */
export function persistLicenseKey(licenseKey: string): void {
  session.licenseKey = licenseKey
  writeLS(LS_LICENSE_KEY, licenseKey)
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

/**
 * Restore the persisted profile (no tokens — those are memory-only).
 * Returns true when a profile exists that MIGHT still be valid; the caller
 * must validate with getMe() before skipping the login.
 */
export function restoreSession(): boolean {
  const companyId = readLS(LS_COMPANY_ID)
  const employeeNumber = readLS(LS_EMPLOYEE_NUMBER)
  if (companyId == null || employeeNumber == null) return false

  session.companyId = Number(companyId)
  session.employeeNumber = employeeNumber
  session.displayName = readLS(LS_DISPLAY_NAME)
  session.role = readLS(LS_ROLE)
  session.licenseKey = readLS(LS_LICENSE_KEY)
  getDeviceId() // ensures deviceId is generated/persisted
  return session.companyId > 0 && session.employeeNumber.length > 0
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
    session.companyId = data.companyId ?? session.companyId
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
  // NOTE: companyId + licenseKey survive logout intentionally: they identify
  // the device/installation, not the employee. Same for deviceId.
  writeLS(LS_EMPLOYEE_NUMBER, null)
  writeLS(LS_DISPLAY_NAME, null)
  writeLS(LS_ROLE, null)
}
