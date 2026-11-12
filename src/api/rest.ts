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
  OrderItemPayload,
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
// Fase 1-P1 · Edición de items de orden PENDIENTE (backend BusinessSuite
// commit 53604e0). Los 3 endpoints devuelven 200 con el RestOrderDetailResponse
// COMPLETO actualizado (mismo shape que GET orders/{id}: items + total) —
// SIN envelope (Ok(detail) directo, como GET /orders/{id}).
// Errores: 400 { message } (validación), 404 { message }, 409
// { currentStatus, message } si la orden ya no está 'pendiente' (carrera:
// alguien la cobró/avanzó mientras tanto). ApiError expone status + message;
// para leer currentStatus del 409 usa readConflictStatus del orders store.
// ---------------------------------------------------------------------------

/**
 * POST api/rest/orders/{id}/items — agrega un item a una orden PENDIENTE.
 * Body IGUAL al item de crear orden (RestAddOrderItemRequest hereda de
 * RestOrderItemRequest): productId (null/omitido para extras standalone),
 * quantity 1-999, notes?, extras [{extraId}], complements number[],
 * selectedOptions [{groupId, valueIds}]. El backend recalcula el precio con
 * la MISMA lógica del create (el precio del cliente es solo display).
 */
export function addOrderItem(
  orderId: number,
  body: OrderItemPayload,
): Promise<ApiResult<OrderDetail>> {
  return apiPost<OrderDetail>(`/api/rest/orders/${encodeURIComponent(orderId)}/items`, body)
}

/**
 * DELETE api/rest/orders/{id}/items/{itemId} — quita un item (y sus extras)
 * de una orden PENDIENTE. 200 con el detalle completo actualizado.
 */
export function removeOrderItem(
  orderId: number,
  itemId: number,
): Promise<ApiResult<OrderDetail>> {
  return apiDelete<OrderDetail>(
    `/api/rest/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
  )
}

/**
 * PATCH api/rest/orders/{id}/items/{itemId} — cambia la cantidad (1-999;
 * 0 → 400: para quitar usa removeOrderItem). El unitario NUNCA se re-precia:
 * total del renglón = UNIT_PRICE congelado × quantity.
 */
export function updateOrderItemQuantity(
  orderId: number,
  itemId: number,
  quantity: number,
): Promise<ApiResult<OrderDetail>> {
  return apiPatch<OrderDetail>(
    `/api/rest/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
    { quantity },
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

// ---------------------------------------------------------------------------
// Admin · Categorías (Fase 6.2 — réplica create_categorias.dart).
// CRUD de categorías de productos del menú con scopes (GLOBAL/SUCURSAL/PLANT).
// Backend en construcción en paralelo por otro agente (BusinessSuite,
// api/rest/catalog/admin/categories). Mismo envelope { success, data, message }.
// ---------------------------------------------------------------------------

/** Una fila de alcance de la categoría (mismo shape que catalog items). */
export interface RestAdminCategoryScope {
  scopeType: CatalogScopeType
  sucursalId?: number | null
  plantId?: number | null
}

/** GET api/rest/catalog/admin/categories?sucursalId=N — categoría + scopes. */
export interface RestAdminCategory {
  id: number
  nombre: string
  /** ISO 8601 (orden DESC en el store, mismo patrón que items). */
  createdAt?: string | null
  scopes?: RestAdminCategoryScope[]
}

/** Body compartido de POST/PUT categorías (scope elegido en ScopeSelector). */
export interface SaveAdminCategoryPayload {
  nombre: string
  scopeType: CatalogScopeType
  sucursalId?: number | null
  plantId?: number | null
}

/** GET …/categories → categorías[] (desenrollado). */
export async function getAdminCategories(
  sucursalId?: number,
): Promise<ApiResult<RestAdminCategory[]>> {
  const query = sucursalId != null ? `?sucursalId=${encodeURIComponent(sucursalId)}` : ''
  const { status, data } = await apiGet<Envelope<RestAdminCategory[]>>(
    `/api/rest/catalog/admin/categories${query}`,
  )
  return { status, data: data.data }
}

/** POST api/rest/catalog/admin/categories → 201 con { id } (desenrollado). */
export interface CreatedAdminCategoryResponse {
  id: number
}

export async function createAdminCategory(
  body: SaveAdminCategoryPayload,
): Promise<ApiResult<CreatedAdminCategoryResponse>> {
  const { status, data } = await apiPost<Envelope<CreatedAdminCategoryResponse>>(
    '/api/rest/catalog/admin/categories',
    body,
  )
  return { status, data: data.data }
}

/** PUT api/rest/catalog/admin/categories/{id} → 200 (desenrollado). */
export async function updateAdminCategory(
  categoryId: number,
  body: SaveAdminCategoryPayload,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiPut<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/categories/${encodeURIComponent(categoryId)}`,
    body,
  )
  return { status, data: data.data }
}

/** DELETE api/rest/catalog/admin/categories/{id} — SOFT delete (desenrollado). */
export async function deleteAdminCategory(
  categoryId: number,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiDelete<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/categories/${encodeURIComponent(categoryId)}`,
  )
  return { status, data: data.data }
}

// ---------------------------------------------------------------------------
// Admin · Productos (Fase 6.3 — builder de productos del menú con grupos de
// opciones; el POS consume optionGroups para el wizard dinámico). Backend en
// construcción en paralelo por otro agente (BusinessSuite,
// api/rest/catalog/admin/products). Mismo envelope { success, data, message }.
// ---------------------------------------------------------------------------

/** Un valor de opción dentro de un grupo: referencia un catalog_item. */
export interface RestAdminProductOptionValue {
  id: number
  catalogItemId: number
  catalogItemName: string
  /** Precio adicional que suma al elegirlo (puede ser negativo). */
  priceModifier: number
  displayOrder: number
  isDefault: boolean
}

/** Grupo de opciones del producto (radio = selección única, checkbox = múltiple). */
export interface RestAdminProductOptionGroup {
  id: number
  groupName: string
  /** 'radio' | 'checkbox' (el wizard del POS lo interpreta igual que Flutter). */
  groupType: string
  minSelections: number
  maxSelections: number
  displayOrder: number
  values: RestAdminProductOptionValue[]
}

/** GET api/rest/catalog/admin/products?sucursalId=N — producto completo. */
export interface RestAdminProduct {
  id: number
  name: string
  description?: string | null
  categoryId?: number | null
  basePrice: number
  imageUrl?: string | null
  isActive: boolean
  /** ISO 8601 (orden DESC en el store, mismo patrón que items). */
  createdAt?: string | null
  scopes?: RestAdminCategoryScope[]
  optionGroups?: RestAdminProductOptionGroup[]
}

/** Valor de opción al guardar: referencia el catalog_item elegido en el picker. */
export interface SaveProductOptionValuePayload {
  catalogItemId: number
  priceModifier?: number
  displayOrder?: number
  isDefault?: boolean
}

/** Grupo de opciones al guardar (sin ids: el backend los asigna). */
export interface SaveProductOptionGroupPayload {
  groupName: string
  groupType: string
  minSelections: number
  maxSelections: number
  displayOrder: number
  values: SaveProductOptionValuePayload[]
}

/** Body de POST api/rest/catalog/admin/products. */
export interface CreateAdminProductPayload {
  name: string
  description?: string | null
  categoryId?: number | null
  basePrice: number
  imageUrl?: string | null
  scopeType: CatalogScopeType
  sucursalId?: number | null
  plantId?: number | null
  optionGroups: SaveProductOptionGroupPayload[]
}

/** PUT api/rest/catalog/admin/products/{id} — mismo body + isActive. */
export type UpdateAdminProductPayload = CreateAdminProductPayload & {
  isActive: boolean
}

/** POST/PUT …/products → { id } (envelope desenrollado). */
export interface SavedAdminProductResponse {
  id: number
}

/** GET …/products → productos[] (desenrollado). */
export async function getAdminProducts(
  sucursalId?: number,
): Promise<ApiResult<RestAdminProduct[]>> {
  const query = sucursalId != null ? `?sucursalId=${encodeURIComponent(sucursalId)}` : ''
  const { status, data } = await apiGet<Envelope<RestAdminProduct[]>>(
    `/api/rest/catalog/admin/products${query}`,
  )
  return { status, data: data.data }
}

/** GET …/products/{id} → producto completo (desenrollado). */
export async function getAdminProduct(
  productId: number,
): Promise<ApiResult<RestAdminProduct>> {
  const { status, data } = await apiGet<Envelope<RestAdminProduct>>(
    `/api/rest/catalog/admin/products/${encodeURIComponent(productId)}`,
  )
  return { status, data: data.data }
}

/** POST …/products → 201 con { id } (desenrollado). */
export async function createAdminProduct(
  body: CreateAdminProductPayload,
): Promise<ApiResult<SavedAdminProductResponse>> {
  const { status, data } = await apiPost<Envelope<SavedAdminProductResponse>>(
    '/api/rest/catalog/admin/products',
    body,
  )
  return { status, data: data.data }
}

/** PUT …/products/{id} → 200 (desenrollado). */
export async function updateAdminProduct(
  productId: number,
  body: UpdateAdminProductPayload,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiPut<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/products/${encodeURIComponent(productId)}`,
    body,
  )
  return { status, data: data.data }
}

/** DELETE …/products/{id} — SOFT delete (desenrollado). */
export async function deleteAdminProduct(
  productId: number,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiDelete<Envelope<Record<string, never>>>(
    `/api/rest/catalog/admin/products/${encodeURIComponent(productId)}`,
  )
  return { status, data: data.data }
}

// ---------------------------------------------------------------------------
// Admin · Usuarios (Fase 7 — réplica user_settings_screen.dart +
// manage_users_screen.dart). CRUD de usuarios Rest (public."AUTH" con
// NUMERO_EMPLEADO no-null + Role Rest*) y asignaciones piso/sucursal
// (rest.employee_floor_assignments). Backend implementado (BusinessSuite
// commit f477599, api/rest/users/admin): guard SOLO RestAdmin/SuperAdmin;
// email + numeroEmpleado únicos GLOBALES (400 descriptivo); PASSWORD_HASH
// jamás en responses. Mismo envelope { success, data, message }.
// ---------------------------------------------------------------------------

/** GET …/roles — catálogo de roles disponibles (RestRoles.AllRoles). */
export interface RestRoleCatalogItem {
  /** Valor EXACTO a enviar en Role (ej. 'RestWaiter'). */
  id: string
  /** Etiqueta corta en español (ej. 'Mesero'). */
  name: string
  /** Descripción corta en español. */
  desc: string
}

/**
 * GET …/users — usuario Rest para el CRUD admin. Espejo de
 * RestUserAdminResponse: NUNCA expone PASSWORD_HASH (backend).
 */
export interface RestAdminUser {
  id: number
  firstName: string
  lastName: string
  email: string
  /** Llave del login Rest — única GLOBAL (todas las empresas). */
  numeroEmpleado: string
  /** RestAdmin | RestManager | RestCashier | RestWaiter | RestKitchen */
  role: string
  isActive: boolean
  /** ISO 8601 (nullable). */
  lastLogin?: string | null
  /** ISO 8601 (nullable). */
  dateRegistered?: string | null
}

/** POST …/users — body de alta (RestCreateUserAdminRequest). */
export interface CreateAdminUserPayload {
  firstName: string
  lastName: string
  email: string
  numeroEmpleado: string
  password: string
  role: string
  /** Default true en el backend; el form siempre lo manda explícito. */
  isActive: boolean
}

/**
 * PUT …/users/{id} — body de edición (RestUpdateUserAdminRequest).
 * numeroEmpleado NO es editable (no existe en el DTO del backend — si se
 * manda el binder lo ignora); password null/'' = no cambiar.
 */
export interface UpdateAdminUserPayload {
  firstName: string
  lastName: string
  email: string
  role: string
  isActive: boolean
  /** Opcional: null/vacío = NO cambiar la contraseña. */
  password?: string | null
}

/** POST …/users → 201 con { id } (envelope desenrollado). */
export interface CreatedAdminUserResponse {
  id: number
}

/** Una asignación piso/sucursal (rest.employee_floor_assignments). */
export interface RestFloorAssignment {
  id: number
  sucursalId: number
  plantId: number
  isActive: boolean
}

/** GET …/users/{id}/floors → { assignments: [...] }. */
export interface RestUserFloorsResponse {
  assignments: RestFloorAssignment[]
}

/** PUT …/users/{id}/floors — reemplazo completo (upsert por par). */
export interface ReplaceUserFloorsPayload {
  assignments: Array<{ sucursalId: number; plantId: number }>
}

/** GET …/roles → roles[] (desenrollado). */
export async function getAdminRoles(): Promise<ApiResult<RestRoleCatalogItem[]>> {
  const { status, data } = await apiGet<Envelope<RestRoleCatalogItem[]>>(
    '/api/rest/users/admin/roles',
  )
  return { status, data: data.data }
}

/**
 * GET …/users?soloActivos= → usuarios[] (desenrollado). Default del backend:
 * soloActivos=false (lista TODO y la UI marca inactivos — réplica Flutter).
 */
export async function getAdminUsers(soloActivos = false): Promise<ApiResult<RestAdminUser[]>> {
  const query = `?soloActivos=${soloActivos}`
  const { status, data } = await apiGet<Envelope<RestAdminUser[]>>(
    `/api/rest/users/admin/users${query}`,
  )
  return { status, data: data.data }
}

/** POST …/users → 201 con { id } (desenrollado). */
export async function createAdminUser(
  body: CreateAdminUserPayload,
): Promise<ApiResult<CreatedAdminUserResponse>> {
  const { status, data } = await apiPost<Envelope<CreatedAdminUserResponse>>(
    '/api/rest/users/admin/users',
    body,
  )
  return { status, data: data.data }
}

/** PUT …/users/{id} → 200 (desenrollado). */
export async function updateAdminUser(
  userId: number,
  body: UpdateAdminUserPayload,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiPut<Envelope<Record<string, never>>>(
    `/api/rest/users/admin/users/${encodeURIComponent(userId)}`,
    body,
  )
  return { status, data: data.data }
}

/**
 * DELETE …/users/{id} — SOFT: isActive=false + floors desactivados (NUNCA
 * borra la fila AUTH).
 */
export async function deleteAdminUser(
  userId: number,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiDelete<Envelope<Record<string, never>>>(
    `/api/rest/users/admin/users/${encodeURIComponent(userId)}`,
  )
  return { status, data: data.data }
}

/** GET …/users/{id}/floors → { assignments } (desenrollado). */
export async function getAdminUserFloors(
  userId: number,
): Promise<ApiResult<RestUserFloorsResponse>> {
  const { status, data } = await apiGet<Envelope<RestUserFloorsResponse>>(
    `/api/rest/users/admin/users/${encodeURIComponent(userId)}/floors`,
  )
  return { status, data: data.data }
}

/** PUT …/users/{id}/floors — reemplazo completo (desenrollado). */
export async function replaceAdminUserFloors(
  userId: number,
  body: ReplaceUserFloorsPayload,
): Promise<ApiResult<Record<string, never>>> {
  const { status, data } = await apiPut<Envelope<Record<string, never>>>(
    `/api/rest/users/admin/users/${encodeURIComponent(userId)}/floors`,
    body,
  )
  return { status, data: data.data }
}
