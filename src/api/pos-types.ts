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
export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'dolares' | 'ambos' | 'PENDIENTE'

/** orderType del POS Piso 1 (heredado de CrazyWings). */
export type OrderType =
  | 'LOCAL'
  | 'DELIVERY'
  | 'EXTERNO'
  | 'UBER'
  | 'DIDI'
  /** Réplica del toggle Flutter (order_panel.dart L843): el app real manda
   *  'UBER/DIDI' literal; el backend Rest guarda ORDER_TYPE sin validar. */
  | 'UBER/DIDI'
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
  /**
   * Ronda caja (réplica order_panel.dart L598-627): SOLO para 'dolares' —
   * USD capturado en el numpad; el backend calcula el MXN con la tasa
   * server-side (el cliente NUNCA multiplica para el payload).
   */
  amountReceivedUsd?: number
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

// ---------------------------------------------------------------------------
// Clientes (Fase 3c · flujo EXTERNO — backend commit 0700a12)
// ---------------------------------------------------------------------------

/**
 * Shape de RestCustomerResponse (BusinessSuite.Shared DTOs, camelCase).
 * Espejo de customer_model.dart del POS CrazyWings.
 */
export interface RestCustomer {
  customerId: number
  customerNumber: string
  customerName: string
  /** INDIVIDUAL | EMPRESA (default INDIVIDUAL). */
  customerType: string
  phone?: string | null
  contactPerson?: string | null
  companyName?: string | null
  deliveryAddress?: string | null
  deliveryTimePreference?: string | null
  comments?: string | null
  /** Última orden asignada (alimenta la lista de frecuentes). */
  lastOrderDate?: string | null
}

/** POST api/rest/customers — body (longitudes = columnas reales). */
export interface CreateCustomerPayload {
  customerNumber: string
  customerName: string
  /** Default backend: INDIVIDUAL (catálogo cerrado INDIVIDUAL|EMPRESA). */
  customerType?: string
  phone?: string | null
  contactPerson?: string | null
  companyName?: string | null
  deliveryAddress?: string | null
  deliveryTimePreference?: string | null
  /** Default backend: NORMAL. */
  status?: string
  comments?: string | null
}

/**
 * PATCH api/rest/customers/{id} — subconjunto editable (null = no tocar).
 * NOTA: el backend NO acepta customerName en el PATCH (deuda documentada:
 * el nombre solo se fija al crear).
 */
export interface UpdateCustomerPayload {
  customerType?: string
  phone?: string | null
  contactPerson?: string | null
  companyName?: string | null
  deliveryAddress?: string | null
  deliveryTimePreference?: string | null
  status?: string
  comments?: string | null
}

// ---------------------------------------------------------------------------
// Caja (ronda cash · backend BusinessSuite rest/cash · envelope {success,data})
// Espejo del cash_session_model.dart del POS CrazyWings.
// ---------------------------------------------------------------------------

/** GET sessions/current · POST sessions/open → CashSession. */
export interface CashSession {
  id: number
  userId: number
  /** ISO timestamp. */
  startTime: string
  endTime?: string | null
  startingAmount: number
  closingAmount?: number | null
  calculatedSales?: number | null
  difference?: number | null
  /** Catálogo cerrado backend: OPEN | CLOSED. */
  status: string
  sucursalId?: number | null
  plantId?: number | null
  notes?: string | null
}

/** GET sessions/{id}/breakdown → totales por método (del SISTEMA). */
export interface SessionBreakdown {
  totalSales: number
  cashTotal: number
  cardTotal: number
  transferTotal: number
  dolaresTotal: number
  dolaresUsdExpected: number
  didiUberCardTotal: number
  didiUberCashTotal: number
  canceledTotal: number
  unclassifiedTotal: number
  orderCount: number
}

/** Terminal de tarjeta capturada (réplica _CardTerminalEntry del Flutter). */
export interface CardTerminalEntry {
  name: string
  amount: number
}

/**
 * Fila del desglose de efectivo (réplica _DenominationRow del Flutter).
 * `value` = monto capturado/libre; para denominaciones fijas el total es qty*value_unit.
 */
export interface DenominationEntry {
  label: string
  qty: number
  /** Valor unitario (0 para filas de valor libre — Guardado/Cambio). */
  value: number
  isUsd: boolean
}

/** GET/PUT sessions/{id}/reconciliation → arqueo persistido. */
export interface Reconciliation {
  sessionId: number
  didiCash: number
  expenses: number
  cardTerminals: CardTerminalEntry[]
  cardTerminalsTotal: number
  cardTerminalsCountedTotal: number
  transferCountedTotal: number
  denominations: DenominationEntry[]
  denominationsTotal: number
  notes?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

/** PUT sessions/{id}/reconciliation — body. */
export interface SaveReconciliationPayload {
  didiCash: number
  expenses: number
  cardTerminals: CardTerminalEntry[]
  cardTerminalsCountedTotal: number
  transferCountedTotal: number
  denominations: DenominationEntry[]
  denominationsTotal: number
  notes?: string | null
}

/** POST sessions/{id}/close → respuesta del cierre. */
export interface CloseCashSessionResponse {
  sessionId: number
  status: 'CLOSED'
  endTime: string
  closingAmount: number
  calculatedSales: number
  expectedCash: number
  difference: number
  breakdown: SessionBreakdown
}

/** POST sessions/{id}/close — body. */
export interface CloseCashSessionPayload {
  denominationsTotal: number
  notes?: string | null
  /** Arqueo persistido en la misma transacción (opcional). */
  reconciliation?: SaveReconciliationPayload
}

/** GET dollar-rate → { rate, updatedAt } | null (sin tasa configurada). */
export interface DollarRate {
  rate: number
  updatedAt?: string | null
}

/** PUT dollar-rate — body. */
export interface UpdateDollarRatePayload {
  rate: number
}

/** POST api/rest/orders/{id}/print-log — log de impresión de tickets. */
export interface TicketPrintLogPayload {
  /** 'kitchen' | 'client'. */
  printType: string
  printerName?: string | null
  success: boolean
  errorMessage?: string | null
}
