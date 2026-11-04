/**
 * TekLive Rest · Typed API functions.
 *
 * Types below mirror the REAL backend DTOs read from BusinessSuite (Fase 1A,
 * commit 6dd9efa) AND verified against the running API (2026-11-03):
 *
 * - BusinessSuite.Api/Controllers/Rest/RestAuthController.cs
 *     · POST api/rest/auth/login  → { token, refreshToken, user }  (camelCase!)
 *       Body: employeeNumber + password + device info. NO company field: the
 *       backend deduces the company from the globally-unique employee number.
 *     · GET  api/rest/auth/me     → { id, firstName, lastName, email, role,
 *                                    companyId, companyName?, employeeNumber? }
 * - BusinessSuite.Api/Controllers/SaaS/AuthController.cs
 *     · POST api/saas/auth/refreshToken → { token, refreshToken? }
 *       (loginApp is no longer used by this client.)
 * - BusinessSuite.Api/Controllers/Rest/RestDiagnosticController.cs
 *     · GET api/rest/diagnostic/health → { status, module, message, apiVersion, serverUtcNow }
 *
 * ASP.NET Core default JSON = camelCase (JsonSerializerDefaults.Web), verified
 * against live responses. Error JSON uses `{ message }` (middleware + controllers).
 */

import { apiGet, apiPatch, apiPost, type ApiResult } from './client'
import type {
  Catalog,
  CreateOrderPayload,
  CreatedOrderResponse,
  OrderDetail,
  PaymentMethod,
  PaymentResponse,
  PendingOrderListItem,
  UpdateOrderStatusPayload,
} from './pos-types'

// ---------------------------------------------------------------------------
// Shared DTO shapes (mirror BusinessSuite.Shared DTOs)
// ---------------------------------------------------------------------------

/** BusinessSuite.Shared.DTOs.SaaS.Response.UserInfo — serialized camelCase. */
export interface UserInfo {
  id: number
  firstName: string
  lastName: string
  email: string
  role: string
  companyId?: number | null
}

/**
 * GET api/rest/auth/me — BusinessSuite.Shared.DTOs.Rest.Response.RestMeResponse.
 * Serialized camelCase by ASP.NET Core web defaults.
 */
export interface RestMeResponse {
  id: number
  firstName: string
  lastName: string
  email: string
  role: string
  companyId?: number | null
  companyName?: string | null
  employeeNumber?: string | null
}

/** GET api/rest/diagnostic/health */
export interface RestHealthResponse {
  status: string
  module: string
  message: string
  apiVersion: string
  serverUtcNow: string
}

/** POST api/rest/auth/login response — UserLoginResponse serialized camelCase. */
export interface RestLoginResponse {
  token: string
  refreshToken: string
  user: UserInfo
}

/** POST api/saas/auth/refreshToken response. */
export interface TokenRefreshResponse {
  token: string
  refreshToken?: string
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET api/rest/diagnostic/health — connectivity + API identity check. */
export function health(): Promise<ApiResult<RestHealthResponse>> {
  return apiGet<RestHealthResponse>('/api/rest/diagnostic/health')
}

/**
 * POST api/rest/auth/login — employee login.
 * Body mirrors RestEmployeeLoginRequest (EmployeeNumber, Password,
 * DeviceId?, DeviceName?, Platform?, AppKey). The backend deduces the
 * company from the globally-unique employee number — NO companyId is sent.
 */
export function loginEmployee(body: {
  employeeNumber: string
  password: string
  deviceId?: string
  deviceName?: string
  platform?: string
  appKey?: string
}): Promise<ApiResult<RestLoginResponse>> {
  return apiPost<RestLoginResponse>('/api/rest/auth/login', {
    employeeNumber: body.employeeNumber,
    password: body.password,
    deviceId: body.deviceId,
    deviceName: body.deviceName,
    platform: body.platform ?? 'web',
    appKey: body.appKey ?? 'app.teklive.rest',
  })
}

/** GET api/rest/auth/me — authenticated employee profile. */
export function getMe(): Promise<ApiResult<RestMeResponse>> {
  return apiGet<RestMeResponse>('/api/rest/auth/me')
}

/**
 * POST api/saas/auth/refreshToken — refresh session.
 * The SaaS controller also accepts the refresh token via HttpOnly cookie;
 * web clients without the cookie pass it in the body. Property names are
 * PascalCase HERE (TokenRefreshRequest is bound by model binder; ASP.NET Core
 * JSON binding is case-insensitive by default, but the request DTO keeps
 * PascalCase names — verified TokenRefreshRequest.cs).
 */
export function refreshToken(token?: string): Promise<ApiResult<TokenRefreshResponse>> {
  return apiPost<TokenRefreshResponse>('/api/saas/auth/refreshToken', {
    refreshToken: token,
  })
}

// ---------------------------------------------------------------------------
// POS Piso 1 · catálogo y órdenes (backend Fase 3b en paralelo)
// Los stores deciden mock vs API real (ver src/stores/*.ts, USE_MOCK).
// ---------------------------------------------------------------------------

/** GET api/rest/catalog?plantId=&sucursalId= — catálogo completo del POS. */
export function getCatalog(plantId: number, sucursalId: number): Promise<ApiResult<Catalog>> {
  return apiGet<Catalog>(
    `/api/rest/catalog?plantId=${encodeURIComponent(plantId)}&sucursalId=${encodeURIComponent(sucursalId)}`,
  )
}

/** POST api/rest/orders — crea orden (con payment = venta, sin = pendiente). */
export function createOrder(body: CreateOrderPayload): Promise<ApiResult<CreatedOrderResponse>> {
  return apiPost<CreatedOrderResponse>('/api/rest/orders', body)
}

/**
 * GET api/rest/orders?plantId=&date=&status= — lista de órdenes.
 * `date` formato YYYY-MM-DD; `status` opcional (p.ej. 'pendiente').
 */
export function getOrders(params: {
  plantId: number
  date: string
  status?: string
}): Promise<ApiResult<PendingOrderListItem[]>> {
  const query = new URLSearchParams({
    plantId: String(params.plantId),
    date: params.date,
  })
  if (params.status != null) query.set('status', params.status)
  return apiGet<PendingOrderListItem[]>(`/api/rest/orders?${query.toString()}`)
}

/** GET api/rest/orders/{id} — detalle con items. */
export function getOrderDetail(orderId: number): Promise<ApiResult<OrderDetail>> {
  return apiGet<OrderDetail>(`/api/rest/orders/${encodeURIComponent(orderId)}`)
}

/**
 * POST api/rest/orders/{id}/payment — cobra una orden pendiente.
 * 409 con `{ currentStatus }` si el estado ya no es el esperado (carrera).
 */
export function payOrder(
  orderId: number,
  body: { method: PaymentMethod; amountReceived: number; expectedStatus: string },
): Promise<ApiResult<PaymentResponse>> {
  return apiPost<PaymentResponse>(`/api/rest/orders/${encodeURIComponent(orderId)}/payment`, body)
}

/**
 * PATCH api/rest/orders/{id}/status — avanza el estado con control de
 * concurrencia (expectedStatus). 409 con `{ currentStatus }` en carrera.
 */
export function updateOrderStatus(
  orderId: number,
  body: UpdateOrderStatusPayload,
): Promise<ApiResult<Record<string, never>>> {
  return apiPatch<Record<string, never>>(
    `/api/rest/orders/${encodeURIComponent(orderId)}/status`,
    body,
  )
}
