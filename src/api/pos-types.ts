/**
 * TekLive Rest · Tipos del módulo POS Piso 1 (Fase 3).
 *
 * Contrato del backend en construcción (Fase 3b backend, en paralelo):
 * - GET  api/rest/catalog?plantId=&sucursalId=  → Catalog
 * - POST api/rest/orders                        → 201 CreatedOrderResponse
 * - GET  api/rest/orders?plantId=&date=&status= → PendingOrderListItem[]
 * - GET  api/rest/orders/{id}                   → OrderDetail
 * - POST api/rest/orders/{id}/payment           → 200 PaymentResponse / 409
 * - PATCH api/rest/orders/{id}/status           → 200 / 409
 *
 * Statuses (español, catálogo cerrado):
 *   pendiente | preparando | listo | entregado | pagado | cancelada
 * Métodos de pago (catálogo cerrado):
 *   efectivo | tarjeta | ambos | PENDIENTE
 *
 * NOTA QA (ronda 3): los campos `conditionalRules` / `priceRules` son los que
 * define el mock de catálogo; cuando el backend fije su forma exacta se ajustan
 * AQUÍ y en `src/mocks/catalog.ts` — el resto de la app consume `Catalog`.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface CatalogCategory {
  id: number
  name: string
}

export interface CatalogOptionValue {
  id: number
  name: string
  /** Modificador de precio que suma al total dinámico (0 = gratis). */
  price: number
}

export interface CatalogOptionGroup {
  id: number
  name: string
  /** Mínimo de selecciones exigidas (0 = opcional). */
  minSelect: number
  /** Máximo de selecciones permitidas (la UI bloquea al llegar). */
  maxSelect: number
  values: CatalogOptionValue[]
}

/**
 * Regla condicional entre grupos (contrato backend RestCatalogConditionalRule):
 * el grupo `targetGroupId` se muestra/oculta según haya selección en
 * `triggerGroupId` (o del valor `triggerValueId` específico si viene).
 * F4 (QA ronda 1): `action` llega verbatim de BD en minúsculas ('show'|'hide');
 * el consumo SIEMPRE normaliza con toLowerCase().
 */
export interface CatalogConditionalRule {
  id: number
  triggerGroupId: number
  /** Valor específico que dispara la regla (null = cualquier selección). */
  triggerValueId?: number | null
  targetGroupId: number
  action: string
}

export interface CatalogTemplate {
  id: number
  name: string
  basePrice: number
  categoryId: number
  hasImage: boolean
  optionGroups: CatalogOptionGroup[]
  conditionalRules: CatalogConditionalRule[]
}

export interface CatalogExtra {
  id: number
  name: string
  price: number
}

export interface CatalogComplementHeader {
  id: number
  name: string
}

export interface CatalogComplementDetail {
  id: number
  headerId: number
  name: string
  price: number
}

export interface CatalogComplements {
  headers: CatalogComplementHeader[]
  details: CatalogComplementDetail[]
}

export interface CatalogSalsa {
  id: number
  name: string
}

/** Respuesta completa de GET api/rest/catalog. */
export interface Catalog {
  categories: CatalogCategory[]
  templates: CatalogTemplate[]
  extras: CatalogExtra[]
  complements: CatalogComplements
  salsas: CatalogSalsa[]
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

/** Catálogo cerrado de estados (backend Fase 3b). */
export type OrderStatus =
  | 'pendiente'
  | 'preparando'
  | 'listo'
  | 'entregado'
  | 'pagado'
  | 'cancelada'

/** Catálogo cerrado de métodos de pago. */
export type PaymentMethod = 'efectivo' | 'tarjeta' | 'ambos' | 'PENDIENTE'

/** orderType del POS Piso 1 (heredado de CrazyWings). */
export type OrderType =
  | 'LOCAL'
  | 'DELIVERY'
  | 'EXTERNO'
  | 'UBER'
  | 'DIDI'
  | 'TRANSFER_P1_P2'

export interface OrderItemExtraPayload {
  extraId: number
}

/**
 * F3 (QA ronda 1): el backend espera `complements: List<int>` (ids de
 * complement_detail) — ver RestOrderItemRequest.Complements. NO es lista de
 * objetos { idcomp }. Ya no se define un payload por complemento.
 */

/** Opciones dinámicas seleccionadas de un grupo. */
export interface OrderItemSelectedOption {
  groupId: number
  valueIds: number[]
}

export interface OrderItemPayload {
  /**
   * Ronda 2 (réplica tab EXTRAS): opcional SOLO para ítems standalone de
   * extras (productId=extra.id del Flutter colisiona con ids de templates y
   * el backend lo resolvería como template — ver cart.ts). El backend valida
   * `ProductId > 0` al deserializar; los items de extras viajan sin productId
   * y su precio vive 100% en `extras`. Para productos normales es obligatorio.
   */
  productId?: number
  quantity: number
  notes?: string
  extras: OrderItemExtraPayload[]
  /** Ids simples de complement_detail (contrato backend: List<int>). */
  complements: number[]
  /** Solo para templates con optionGroups (addDynamicItem). */
  selectedOptions?: OrderItemSelectedOption[]
}

export interface OrderPaymentPayload {
  method: PaymentMethod
  amountReceived: number
}

/** POST api/rest/orders — body completo. */
export interface CreateOrderPayload {
  plantId: number
  sucursalId: number
  /** Mesa genérica del POS Piso 1 (convención CrazyWings). */
  tableId: number
  orderType: OrderType
  customerId?: number
  platformDeliveryInfo?: string
  cashSessionId?: number
  payment?: OrderPaymentPayload
  items: OrderItemPayload[]
}

/** POST api/rest/orders → 201. El backend recalcula el total. */
export interface CreatedOrderResponse {
  id: number
  dailyOrderNumber: number
  orderStatus: OrderStatus
  total: number
  changeAmount?: number
}

/** GET api/rest/orders?plantId=&date=&status=pendiente — fila de lista. */
export interface PendingOrderListItem {
  id: number
  dailyOrderNumber: number
  orderStatus: OrderStatus
  total: number
  createdAt: string
  itemCount: number
  waiterName: string
}

/**
 * Item del detalle real (GET /orders/{id} → RestOrderDetailItem):
 * `unitPrice` es el campo del backend (NO `price`); el detalle trae `extras`
 * pero NO complements.
 */
export interface OrderDetailItem {
  id: number
  productId?: number
  productName: string
  quantity: number
  unitPrice: number
  notes?: string | null
  extras?: Array<{ extraId: number; name: string; price: number }>
}

/** GET api/rest/orders/{id}. */
export interface OrderDetail {
  id: number
  dailyOrderNumber: number
  orderStatus: OrderStatus
  total: number
  createdAt: string
  orderType: OrderType
  items: OrderDetailItem[]
}

/** POST api/rest/orders/{id}/payment → 200. */
export interface PaymentResponse {
  changeAmount: number
  paidAt: string
}

/** POST payment / PATCH status → 409 (carrera: alguien cambió el estado antes). */
export interface StatusConflictResponse {
  currentStatus: OrderStatus
}

/** PATCH api/rest/orders/{id}/status — body. */
export interface UpdateOrderStatusPayload {
  expectedStatus: OrderStatus
  newStatus: OrderStatus
  notes?: string
}
