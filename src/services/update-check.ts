/**
 * TekLive Rest · Update check — STUB (Fase 5).
 *
 * Planned behavior (plan v2, Fase 5):
 * - Desktop (Tauri): GET /api/rest/desktop/updates/ → version + installer URL.
 *   Both endpoints are EXEMPT from X-Api-Key and LicenseGuard middlewares so a
 *   client with an expired license can still self-update.
 * - Android (Capacitor): GET /api/rest/android/updates/ → APK download.
 * - Until then this module is a documented no-op.
 */
export interface UpdateCheckResult {
  updateAvailable: boolean
  message: string
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  // TODO(Fase 5): implement desktop/APK update check against the exempt
  // updater endpoints. Intentionally a no-op in the scaffold.
  return { updateAvailable: false, message: 'Updater arrives in Fase 5.' }
}
