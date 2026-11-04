/**
 * TekLive Rest · API client wrapper.
 *
 * - baseURL from VITE_API_BASE_URL (default: local BusinessSuite API).
 * - Automatic headers:
 *    · Authorization: Bearer <token>  — access token kept in memory only.
 *    · X-Api-Key: VITE_APP_API_KEY    — shared Rest module key (AppApiKeyMiddleware).
 * - Typed error handling: reads `{ message }` / `{ Message }` from JSON errors.
 *
 * NOTE: the access token lives in `src/services/auth.ts` (in-memory only,
 * never persisted to localStorage).
 */

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

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
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
    // 401 with a live in-memory token usually means the access token expired.
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
