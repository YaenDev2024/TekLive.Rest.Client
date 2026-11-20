/**
 * TekLive Rest · API client wrapper.
 *
 * - baseURL from VITE_API_BASE_URL (default: local BusinessSuite API).
 * - Automatic headers:
 *    · Authorization: Bearer <token>  — access token kept in memory only.
 *    · X-Api-Key: VITE_APP_API_KEY    — shared Rest module key (AppApiKeyMiddleware).
 * - Typed error handling: reads `{ message }` / `{ Message }` from JSON errors.
 * - 401 → silent refresh rotation + single retry (see below).
 *
 * NOTE: the access token lives in `src/services/auth.ts` (in-memory only,
 * never persisted to localStorage). The REFRESH token persists in
 * localStorage (rest.refreshToken) so a page reload (F5) resumes the
 * session silently via POST /auth/refresh instead of kicking to login.
 */
import { getRefreshToken, applyRefreshedTokens } from '../services/auth'

/** Access token holder, injected by the auth service at startup. */
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:5171'

const APP_API_KEY: string =
  (import.meta.env.VITE_APP_API_KEY as string | undefined) ?? 'dev-rest-api-key-local'

/** Standard error thrown by every failed API call. */
export class ApiError extends Error {
  readonly status: number
  readonly reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.reason = reason
  }
}

interface ErrorShape {
  message?: string
  Message?: string
  reason?: string
  Reason?: string
}

function extractMessage(payload: unknown, fallback = 'Error inesperado. Intenta de nuevo.'): string {
  if (payload && typeof payload === 'object') {
    const shape = payload as ErrorShape
    const msg = shape.message ?? shape.Message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  return fallback
}

function extractReason(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const shape = payload as ErrorShape
    const reason = shape.reason ?? shape.Reason
    if (typeof reason === 'string' && reason.length > 0) return reason
  }
  return undefined
}

/**
 * Headers de autenticación compartidos por TODAS las llamadas al módulo Rest
 * (JSON, multipart y binario):
 *  · X-Api-Key — lo exige AppApiKeyMiddleware (sin él: 401 "Aplicación no
 *    autorizada").
 *  · Authorization: Bearer — el JWT vive SOLO en memoria.
 *
 * Importante para imágenes: ni `<img src>` ni `<a href>` pueden enviar estos
 * headers, así que los binarios se bajan con apiDownload() y se pintan como
 * object URL (ver src/api/productImages.ts).
 */
function applyAuthHeaders(headers: Headers): void {
  headers.set('X-Api-Key', APP_API_KEY)
  if (accessToken != null) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
}

export interface ApiResult<T> {
  status: number
  data: T
}

// ---------------------------------------------------------------------------
// Refresh silencioso (fix 401 "Error inesperado"): el access token dura 15 min
// y vive en memoria; cuando expira, TODA llamada responde 401 con cuerpo sin
// `message` (el fallback genérico confundía al usuario). En 401 intentamos
// rotar el refresh token UNA vez (single-flight: peticiones concurrentes
// comparten la misma promesa) y reintentamos la petición original con el token
// nuevo. Si la rotación falla → sesión realmente terminada: error claro.
// ---------------------------------------------------------------------------

/** Refresh en curso (single-flight): las 401s concurrentes esperan la misma. */
let refreshInFlight: Promise<boolean> | null = null

/** Error de sesión terminada (refresh falló o no hay refresh token). */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'Tu sesión expiró. Inicia sesión de nuevo.')
  }
}

/** Hook de logout forzado: lo registra services/auth.ts (redirect a /login). */
let onSessionExpired: (() => void) | null = null

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

/** Rota el refresh token contra POST /api/rest/auth/refresh (una vez por racha de 401s). */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight != null) return refreshInFlight

  refreshInFlight = (async () => {
    const current = getRefreshToken()
    if (current == null || current.length === 0) return false

    try {
      const response = await fetch(`${BASE_URL}/api/rest/auth/refresh`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': APP_API_KEY,
        },
        body: JSON.stringify({ refreshToken: current }),
      })
      if (!response.ok) return false

      const payload = (await response.json()) as {
        Token?: string
        RefreshToken?: string
        token?: string
        refreshToken?: string
      }
      const newAccess = payload.Token ?? payload.token
      const newRefresh = payload.RefreshToken ?? payload.refreshToken
      if (newAccess == null || newAccess.length === 0) return false

      applyRefreshedTokens(newAccess, newRefresh ?? current)
      return true
    } catch {
      return false
    }
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

/**
 * Rotador público para el resume tras recarga (router guard → auth.ts
 * tryResumeFromPersistedRefresh). Single-flight compartido con el handler
 * de 401s: si una rotación ya corre, ambos esperan la misma promesa. El
 * token a usar lo lee refreshAccessToken() vía getRefreshToken() (que tras
 * un reload lo resuelve desde localStorage).
 */
export function rotatePersistedRefresh(_refreshToken: string): Promise<boolean> {
  return refreshAccessToken()
}

async function request<T>(path: string, init: RequestInit, allowRetry = true): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body != null && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    // FormData NUNCA debe recibir un Content-Type manual: el navegador lo
    // genera con el boundary correcto (ver apiUpload).
    headers.set('Content-Type', 'application/json')
  }
  applyAuthHeaders(headers)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  } catch {
    // Network failure (API down, CORS, DNS...).
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexión.')
  }

  if (response.status === 204) {
    return { status: response.status, data: undefined as T }
  }

  let payload: unknown = null
  const text = await response.text()
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    // 401 → el access token expiró (o es inválido): rotar y reintentar UNA vez.
    // Excluye los endpoints de auth (login no tiene sesión que rotar; evita
    // bucles en refresh/me).
    const isAuthCall = path.startsWith('/api/rest/auth/')
    if (response.status === 401 && isAuthCall === false && allowRetry) {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        return request<T>(path, init, false) // reintento único con el token nuevo
      }
      // Sesión realmente terminada: mensaje claro + logout/redirect.
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
    throw new ApiError(response.status, extractMessage(payload), extractReason(payload))
  }

  return { status: response.status, data: payload as T }
}

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'GET' })
}

export function apiPost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
}

/** PUT (reemplazo completo) — mismo patrón que apiPatch (ronda cash). */
export function apiPut<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
}

/** DELETE — mismo patrón que apiGet/apiPut (Fase 6.1 admin catálogo: soft delete). */
export function apiDelete<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Upload / descarga binaria (imágenes de producto del catálogo Rest).
//
// Por qué existen: el endpoint de imágenes exige X-Api-Key + Bearer, y un
// `<img src="…">` no puede enviar headers. Todo binario pasa por aquí y se
// pinta como object URL (ver src/api/productImages.ts).
// ---------------------------------------------------------------------------

/** Respuesta de error de una llamada binaria → ApiError (mismo formato que request). */
async function toBinaryError(response: Response, fallback: string): Promise<ApiError> {
  let payload: unknown = null
  try {
    const text = await response.text()
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        payload = text
      }
    }
  } catch {
    // Cuerpo ilegible (p.ej. binario en un error): se usa el fallback.
  }
  return new ApiError(response.status, extractMessage(payload, fallback), extractReason(payload))
}

/**
 * POST multipart/form-data con la misma auth que request() y el mismo
 * reintento único en 401.
 *
 * ⚠️ NO se fija `Content-Type`: el navegador debe generarlo para incluir el
 * boundary del multipart. Fijarlo a mano rompe la subida en el servidor.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<ApiResult<T>> {
  const url = `${BASE_URL}${path}`

  const send = async (): Promise<Response> => {
    const headers = new Headers()
    headers.set('Accept', 'application/json')
    applyAuthHeaders(headers) // sin Content-Type a propósito (boundary del browser)
    try {
      return await fetch(url, { method: 'POST', headers, body: formData })
    } catch {
      throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexión.')
    }
  }

  let response = await send()

  if (response.status === 401 && !path.startsWith('/api/rest/auth/')) {
    // Rotación + reintento ÚNICO (duplicado acotado de la lógica de request(),
    // que parsea el cuerpo como JSON y aquí necesitamos un FormData intacto).
    const refreshed = await refreshAccessToken()
    if (refreshed === false) {
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
    response = await send()
  }

  if (response.status === 204) {
    return { status: response.status, data: undefined as T }
  }

  let payload: unknown = null
  const text = await response.text()
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractMessage(payload, 'No se pudo subir la imagen. Intenta de nuevo.'),
      extractReason(payload),
    )
  }

  return { status: response.status, data: payload as T }
}

/**
 * GET binario con la misma auth que request() y reintento único en 401.
 *
 * Devuelve el Blob tal cual. Un 404 se propaga como ApiError(404) para que el
 * llamador decida (productImages lo traduce a "sin imagen"), nunca como algo
 * que rompa el render.
 *
 * CACHÉ: `cache: 'no-cache'` (revalidar, NO ignorar la caché).
 * Las imágenes se sirven con `Cache-Control: private, max-age=300` + ETag y su
 * URL es fija (`/catalog/templates/{id}/image`). Con el modo `default` del
 * navegador, durante 5 minutos la respuesta sale de la caché HTTP SIN
 * revalidar: al reemplazar una foto, la app re-descargaba el blob VIEJO y el
 * admin seguía viendo la anterior aunque la subida hubiera funcionado.
 * Con `no-cache` el navegador manda `If-None-Match`: si el ETag no cambió el
 * server responde 304 (sin re-descargar bytes) y si cambió, 200 con la imagen
 * nueva. `no-store` NO se usa a propósito: tiraría la caché entera y volvería
 * a bajar los bytes de cada imagen en cada carga del menú.
 */
export async function apiDownload(path: string, allowRetry = true): Promise<Blob> {
  const headers = new Headers()
  applyAuthHeaders(headers)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-cache',
    })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexión.')
  }

  if (response.ok) {
    return await response.blob()
  }

  if (response.status === 401 && !path.startsWith('/api/rest/auth/') && allowRetry) {
    const refreshed = await refreshAccessToken()
    if (refreshed === false) {
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
    return apiDownload(path, false)
  }

  throw await toBinaryError(response, 'No se pudo descargar la imagen.')
}
