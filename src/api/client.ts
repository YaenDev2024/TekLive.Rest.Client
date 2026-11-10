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
 * never persisted to localStorage).
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

function extractMessage(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const shape = payload as ErrorShape
    const msg = shape.message ?? shape.Message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  return 'Error inesperado. Intenta de nuevo.'
}

function extractReason(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const shape = payload as ErrorShape
    const reason = shape.reason ?? shape.Reason
    if (typeof reason === 'string' && reason.length > 0) return reason
  }
  return undefined
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

async function request<T>(path: string, init: RequestInit, allowRetry = true): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('X-Api-Key', APP_API_KEY)
  if (accessToken != null) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

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
