/**
 * TekLive Rest · Manifiesto de actualización Android.
 *
 * El JSON viene de la red y de un endpoint anónimo: se valida campo por campo
 * antes de usarlo. Un `versionCode` que llegue como string o un
 * `apks.universal` ausente debe cortar el flujo aquí, no reventar tres pasos
 * más adelante en medio de una descarga.
 *
 * Contrato (GET /api/rest/android/updates/latest.json, sin X-Api-Key):
 * {
 *   "versionCode": 400,
 *   "versionName": "0.4.0",
 *   "minSdk": 22,
 *   "mandatory": false,
 *   "notes": "…",
 *   "publishedAt": "2026-11-26T03:16:53Z",
 *   "apks": { "universal": { "url": "...", "sha256": "...", "size": 18765432 } }
 * }
 *
 * `versionCode` es la ÚNICA fuente de verdad del orden de versiones. Nunca se
 * compara `versionName`: "1.10" < "1.9" en orden lexicográfico.
 */

/** APK universal (el único artefacto que publica el backend hoy). */
export interface AndroidApk {
  url: string
  /** SHA-256 en hex minúsculas, 64 caracteres, sin separadores. */
  sha256: string
  /** Tamaño en bytes. 0 = el servidor no lo declaró (se omite el gate previo). */
  size: number
}

export interface AndroidUpdateManifest {
  versionCode: number
  versionName: string
  /** minSdk del APK; 0 = desconocido (no se filtra por SDK). */
  minSdk: number
  /**
   * Se conserva por compatibilidad de contrato. En Rest NUNCA bloquea nada:
   * instalar mata la app y puede costar una venta o un corte de caja.
   */
  mandatory: boolean
  notes: string
  publishedAt: string
  apks: { universal: AndroidApk }
}

const MANIFEST_PATH = '/api/rest/android/updates/latest.json'
/** Host canónico del API cuando no hay VITE_API_BASE_URL configurada. */
const DEFAULT_ORIGIN = 'https://tekliveplus.com'

/**
 * URL del manifiesto.
 *
 * Se prefiere VITE_API_BASE_URL (misma base que el cliente HTTP) y se cae al
 * host canónico si está vacía o es relativa: dentro del WebView de Capacitor el
 * origen es `https://localhost`, así que una URL relativa apuntaría a la app
 * misma y el updater fallaría en silencio para siempre.
 */
export function resolveAndroidManifestUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (configured) {
    try {
      return new URL(MANIFEST_PATH, configured).toString()
    } catch {
      // Base inválida: se ignora y se usa el host canónico.
    }
  }
  return DEFAULT_ORIGIN + MANIFEST_PATH
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

function nonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (!Number.isInteger(value) || value < 0) return 0
  return value
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** SHA-256 normalizado a hex minúsculas sin separadores, o '' si no sirve. */
function normalizeSha256(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/:/g, '').replace(/\s/g, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ''
}

/**
 * Valida el manifiesto completo. Devuelve `null` ante cualquier forma
 * inesperada: quien llama simplemente no hace nada esa vuelta.
 */
export function parseAndroidManifest(payload: unknown): AndroidUpdateManifest | null {
  if (!isRecord(payload)) return null

  const versionCode = positiveInt(payload.versionCode)
  if (versionCode === null) return null

  const versionName = text(payload.versionName).trim()
  if (!versionName) return null

  const apks = payload.apks
  if (!isRecord(apks)) return null
  const universal = apks.universal
  if (!isRecord(universal)) return null

  const url = text(universal.url).trim()
  // Una URL http permitiría que un intermediario sustituya el APK. El SHA-256
  // lo cortaría igual, pero se exige https antes de bajar nada.
  if (!url.toLowerCase().startsWith('https://')) return null

  const sha256 = normalizeSha256(universal.sha256)
  if (!sha256) return null

  return {
    versionCode,
    versionName,
    minSdk: nonNegativeInt(payload.minSdk),
    mandatory: payload.mandatory === true,
    notes: text(payload.notes),
    publishedAt: text(payload.publishedAt),
    apks: {
      universal: {
        url,
        sha256,
        size: nonNegativeInt(universal.size),
      },
    },
  }
}
