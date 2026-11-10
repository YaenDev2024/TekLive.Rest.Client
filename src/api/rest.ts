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

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, type ApiResult } from './client'
import type {
  Catalog,
  CloseCashSessionPayload,
  CloseCashSessionResponse,
  CreateOrderPayload,
  CreatedOrderResponse,
  DollarRate,
  OrderDetail,
  PaymentMethod,
  PaymentResponse,
  PendingOrderListItem,
  Reconciliation,
  SaveReconciliationPayload,
  CashSession,
  SessionBreakdown,
  TicketPrintLogPayload,
  UpdateDollarRatePayload,
  UpdateOrderStatusPayload,
} from './pos-types'

/** Shape del envelope 2xx del módulo Rest (mismo que customers.ts). */
interface Envelope<T> {
  success: boolean
  data: T
  message: string
}

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

/**
 * GET api/rest/floors — piso/planta del restaurante (Fase 4, réplica del
 * FloorProvider de CrazyWings). Espejo de RestFloorResponse del backend
 * (en construcción en paralelo por otro agente — BusinessSuite).
 */
export interface RestFloorResponse {
  floorId: number
  name: string
  description: string | null
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
 * `cashSessionId` (ronda cash) atribuye el cobro a la sesión de caja abierta.
 */
export function payOrder(
  orderId: number,
  body: {
    method: PaymentMethod
    amountReceived: number
    expectedStatus: string
    cashSessionId?: number
  },
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

// ---------------------------------------------------------------------------
// Caja (ronda cash · backend en BusinessSuite bajo api/rest/cash).
// Envelope 2xx = { success, data, message }: mismas convenciones que
// customers.ts — se desenrolla `data` aquí para que la UI consuma el shape.
// ---------------------------------------------------------------------------

/**
 * GET api/rest/floors — pisos/plantas de la sucursal del usuario (Fase 4).
 * Envelope 2xx = { success, data, message }: se desenrolla `data` igual que
 * los endpoints de caja. Devuelve [] si el backend responde lista vacía.
 */
export async function getFloors(): Promise<ApiResult<RestFloorResponse[]>> {
  const { status, data } = await apiGet<Envelope<RestFloorResponse[]>>('/api/rest/floors')
  return { status, data: data.data }
}

/** GET api/rest/cash/dollar-rate → tasa | null (200 sin tasa configurada). */
export async function getDollarRate(): Promise<ApiResult<DollarRate | null>> {
  const { status, data } = await apiGet<Envelope<DollarRate | null>>('/api/rest/cash/dollar-rate')
  return { status, data: data.data }
}

/** PUT api/rest/cash/dollar-rate → tasa actualizada. */
export async function updateDollarRate(body: UpdateDollarRatePayload): Promise<ApiResult<DollarRate>> {
  const { status, data } = await apiPut<Envelope<DollarRate>>('/api/rest/cash/dollar-rate', body)
  return { status, data: data.data }
}

/**
 * POST api/rest/cash/sessions/open — abre sesión de caja para planta/sucursal.
 * 409 con message si ya hay sesión abierta (la UI muestra el message).
 */
export async function openCashSession(body: {
  startingAmount: number
  plantId: number
  sucursalId: number
}): Promise<ApiResult<CashSession>> {
  const { status, data } = await apiPost<Envelope<CashSession>>('/api/rest/cash/sessions/open', body)
  return { status, data: data.data }
}

/** GET api/rest/cash/sessions/current?plantId=&sucursalId= → sesión | null. */
export async function getCurrentCashSession(
  plantId: number,
  sucursalId: number,
): Promise<ApiResult<CashSession | null>> {
  const query = `plantId=${encodeURIComponent(plantId)}&sucursalId=${encodeURIComponent(sucursalId)}`
  const { status, data } = await apiGet<Envelope<CashSession | null>>(
    `/api/rest/cash/sessions/current?${query}`,
  )
  return { status, data: data.data }
}

/** GET api/rest/cash/sessions/{id}/breakdown → totales por método (sistema). */
export async function getSessionBreakdown(sessionId: number): Promise<ApiResult<SessionBreakdown>> {
  const { status, data } = await apiGet<Envelope<SessionBreakdown>>(
    `/api/rest/cash/sessions/${encodeURIComponent(sessionId)}/breakdown`,
  )
  return { status, data: data.data }
}

/** GET api/rest/cash/sessions/{id}/reconciliation → arqueo | null (sin guardar). */
export async function getCashReconciliation(sessionId: number): Promise<ApiResult<Reconciliation | null>> {
  const { status, data } = await apiGet<Envelope<Reconciliation | null>>(
    `/api/rest/cash/sessions/${encodeURIComponent(sessionId)}/reconciliation`,
  )
  return { status, data: data.data }
}

/** PUT api/rest/cash/sessions/{id}/reconciliation → arqueo actualizado. */
export async function saveCashReconciliation(
  sessionId: number,
  body: SaveReconciliationPayload,
): Promise<ApiResult<Reconciliation>> {
  const { status, data } = await apiPut<Envelope<Reconciliation>>(
    `/api/rest/cash/sessions/${encodeURIComponent(sessionId)}/reconciliation`,
    body,
  )
  return { status, data: data.data }
}

/**
 * POST api/rest/cash/sessions/{id}/close — cierre definitivo. El backend
 * recalcula esperado/diferencia; el breakdown de la respuesta es la verdad.
 */
export async function closeCashSession(
  sessionId: number,
  body: CloseCashSessionPayload,
): Promise<ApiResult<CloseCashSessionResponse>> {
  const { status, data } = await apiPost<Envelope<CloseCashSessionResponse>>(
    `/api/rest/cash/sessions/${encodeURIComponent(sessionId)}/close`,
    body,
  )
  return { status, data: data.data }
}

/**
 * POST api/rest/orders/{id}/print-log — registro de impresión de tickets
 * (kitchen/client). Best-effort: la UI ignora fallos (log no bloquea).
 */
export function logTicketPrint(
  orderId: number,
  body: TicketPrintLogPayload,
): Promise<ApiResult<Record<string, never>>> {
  return apiPost<Record<string, never>>(
    `/api/rest/orders/${encodeURIComponent(orderId)}/print-log`,
    body,
  )
}

// ---------------------------------------------------------------------------
// Admin · Gestionar Catálogo (Fase 6.1 — réplica manage_catalog_screen.dart).
// CRUD de catalog_items = OPCIONES del wizard del POS (SALSA, PROTEINA,
// COMPLEMENTO, EXTRA, BEBIDA, MODIFICADOR — p.ej. "Barbacoa"). NO son los
// productos del menú.
// Backend en construcción en paralelo por otro agente (BusinessSuite,
// api/rest/catalog/admin/items). Mientras el endpoint no exista el store
// maneja el error y la vista muestra el estado de error réplica — SIN
// fallback de datos falsos (los datos aquí son reales del negocio).
// ---------------------------------------------------------------------------

/** Alcance de un catalog_item: 'GLOBAL' | 'SUCURSAL' | 'PLANT'. */
export type CatalogScopeType = 'GLOBAL' | 'SUCURSAL' | 'PLANT'

/** Alcances soportados — réplica scope_selector.dart L6-7. */
export const CATALOG_SCOPE_TYPES: CatalogScopeType[] = ['GLOBAL', 'SUCURSAL', 'PLANT']

/**
 * Una fila de alcance del item (GET …/items → scopes[]). Espejo del join
 * CAT_ITEM_SCOPES que el backend expondrá por item.
 */
export interface RestAdminCatalogItemScope {
  scopeType: CatalogScopeType
  sucursalId?: number | null
  plantId?: number | null
}

/**
 * GET api/rest/catalog/admin/items?sucursalId=N — item del pool de opciones
 * del wizard. Espejo de CatalogItem (catalog_item_model.dart L1-33) + scopes.
 */
export interface RestAdminCatalogItem {
  id: number
  nombre: string
  descripcion?: string | null
  /** SALSA | PROTEINA | COMPLEMENTO | EXTRA | BEBIDA | MODIFICADOR */
  tipo: string
  precio: number
  cantidadDisponible: number
  activo: boolean
  /** ISO 8601 (null-tolerante: el modelo Flutter lo marca nullable). */
  createdAt?: string | null
  scopes?: RestAdminCatalogItemScope[]
}

/**
 * POST api/rest/catalog/admin/items — body. `sucursalId` va SIEMPRE (la vista
 * admin lo manda como contexto, réplica createCatalogItem del Flutter);
 * `plantId` solo cuando scopeType === 'PLANT'.
 */
export interface CreateAdminCatalogItemPayload {
  nombre: string
  descripcion?: string | null
  tipo: string
  precio: number
  cantidadDisponible: number
  scopeType: CatalogScopeType
  sucursalId?: number | null
  plantId?: number | null
}

/**
 * PUT api/rest/catalog/admin/items/{id} — mismo body + `activo` (el switch
 * del dialog editar, manage_catalog_screen.dart L326-332/L365).
 */
export type UpdateAdminCatalogItemPayload = CreateAdminCatalogItemPayload & {
  activo: boolean
}

/** POST …/items → 201 { success, data: { id } } (solo el id). */
export interface CreatedAdminCatalogItemResponse {
  id: number
}

/** GET api/rest/catalog/admin/items?sucursalId=N → items[] (desenrollado). */
export async function getAdminCatalogItems(
  sucursalId?: number,
): Promise<ApiResult<RestAdminCatalogItem[]>> {
  const query = sucursalId != null ? `?sucursalId=${encodeURIComponent(sucursalId)}` : ''
  const { status, data } = await apiGet<Envelope<RestAdminCatalogItem[]>>(
    `/api/rest/catalog/admin/items${query}`,
  )
  return { status, data: data.data }
}

/** POST api/rest/catalog/admin/items → 201 con { id } (envelope desenrollado). */
export async function createAdminCatalogItem(
  body: CreateAdminCatalogItemPayload,
): Promise<ApiResult<CreatedAdminCatalogItemResponse>> {
  const { status, data } = await apiPost<Envelope<CreatedAdminCatalogItemResponse>>(
    '/api/rest/catalog/admin/items',
    body,
  )
  return { status, data: data.data }
}

/** PUT api/rest/catalog/admin/items/{id} → 200 (envelope desenrollado). */
export async function updateAdminCatalogItem(
  itemId: number,
  body: UpdateAdminCatalogItemPayload,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiPut<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/items/${encodeURIComponent(itemId)}`,
    body,
  )
  return { status, data: data.data }
}

/**
 * DELETE api/rest/catalog/admin/items/{id} — SOFT delete: el item NO se
 * elimina, solo se oculta (queda con activo=false y la lista lo muestra
 * tachado — réplica del mensaje del confirm del Flutter L399).
 */
export async function deactivateAdminCatalogItem(
  itemId: number,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiDelete<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/items/${encodeURIComponent(itemId)}`,
  )
  return { status, data: data.data }
}
