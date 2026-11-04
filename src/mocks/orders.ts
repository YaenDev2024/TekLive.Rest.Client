/**
 * TekLive Rest · MOCK de órdenes POS Piso 1 (Fase 3b).
 *
 * Simula en memoria el contrato del backend:
 * - createOrderMock: POST /orders (recalcula el "total" como lo hará el
 *   backend; el total del carrito es solo display) con folio diario creciente.
 * - listOrdersMock: GET /orders?plantId=&date=&status=
 * - payOrderMock: POST /orders/{id}/payment (409 si el estado ya no coincide).
 * - updateStatusMock: PATCH /orders/{id}/status (409 en carrera, valida nota
 *   obligatoria en cancelación en el CALLER — aquí solo 409/404).
 *
 * QA (ronda 3): el switch mock→API real es `USE_MOCK` en src/stores/orders.ts.
 * Este archivo NO se importa desde componentes.
 */

import type {
  CreatedOrderResponse,
  OrderStatus,
  PaymentMethod,
  PaymentResponse,
  PendingOrderListItem,
} from '../api/pos-types'
import type { MockOrder } from './orders-mock-state'

export type { MockOrder } from './orders-mock-state'

/**
 * Estado compartido del mock entre los stores de carrito y pendientes
 * (module-level, sobrevive a navegaciones; se reinicia al recargar).
 */
const mockOrders: MockOrder[] = []

/** Folio diario demo: inicia en 42 para que los nuevos folios se distingan. */
let nextDailyOrderNumber = 42
let nextOrderId = 5000

/** Simula el recálculo de total del backend a partir de los items. */
export function computeMockOrderTotal(
  items: Array<{ unitPrice: number; quantity: number }>,
): number {
  return items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)
}

export interface MockCreateItem {
  productName: string
  unitPrice: number
  quantity: number
  notes?: string
}

export function createMockOrder(body: {
  waiterName: string
  payment?: { method: PaymentMethod; amountReceived: number }
  items: MockCreateItem[]
}): CreatedOrderResponse {
  const orderStatus: OrderStatus = body.payment != null ? 'pagado' : 'pendiente'
  const total = computeMockOrderTotal(body.items)
  const changeAmount =
    body.payment != null && body.payment.method !== 'tarjeta'
      ? Math.max(0, body.payment.amountReceived - total)
      : 0

  const order: MockOrder = {
    id: nextOrderId++,
    dailyOrderNumber: nextDailyOrderNumber++,
    orderStatus,
    total,
    createdAt: new Date().toISOString(),
    itemCount: body.items.reduce((n, it) => n + it.quantity, 0),
    waiterName: body.waiterName,
    items: body.items.map((it, index) => ({
      id: nextOrderId * 10 + index,
      productName: it.productName,
      quantity: it.quantity,
      price: it.unitPrice,
      notes: it.notes ?? null,
    })),  }
  mockOrders.unshift(order)
  return {
    id: order.id,
    dailyOrderNumber: order.dailyOrderNumber,
    orderStatus: order.orderStatus,
    total: order.total,
    changeAmount: body.payment != null ? changeAmount : undefined,
  }
}

/** Lista órdenes mock (filtro por status; date/plantId se ignoran en demo). */
export function listMockOrders(status?: string): PendingOrderListItem[] {
  return mockOrders
    .filter((o) => (status == null ? true : o.orderStatus === status))
    .map((o) => ({
      id: o.id,
      dailyOrderNumber: o.dailyOrderNumber,
      orderStatus: o.orderStatus,
      total: o.total,
      createdAt: o.createdAt,
      itemCount: o.itemCount,
      waiterName: o.waiterName,
    }))
}

export function getMockOrder(orderId: number): MockOrder | undefined {
  return mockOrders.find((o) => o.id === orderId)
}

/** Cobra una orden mock. Devuelve null → 409 con currentStatus. */
export function payMockOrder(
  orderId: number,
  body: { method: PaymentMethod; amountReceived: number; expectedStatus: string },
): { ok: true; data: PaymentResponse } | { ok: false; conflictStatus: OrderStatus | 'not-found' } {
  const order = mockOrders.find((o) => o.id === orderId)
  if (order == null) return { ok: false, conflictStatus: 'not-found' }
  if (order.orderStatus !== body.expectedStatus) {
    return { ok: false, conflictStatus: order.orderStatus }
  }
  const changeAmount =
    body.method === 'tarjeta' ? 0 : Math.max(0, body.amountReceived - order.total)
  order.orderStatus = 'pagado'
  return {
    ok: true,
    data: { changeAmount, paidAt: new Date().toISOString() },
  }
}

/** Avanza estado de una orden mock. null → 409. */
export function updateMockOrderStatus(
  orderId: number,
  body: { expectedStatus: OrderStatus; newStatus: OrderStatus },
): { ok: true } | { ok: false; conflictStatus: OrderStatus | 'not-found' } {
  const order = mockOrders.find((o) => o.id === orderId)
  if (order == null) return { ok: false, conflictStatus: 'not-found' }
  if (order.orderStatus !== body.expectedStatus) {
    return { ok: false, conflictStatus: order.orderStatus }
  }
  order.orderStatus = body.newStatus
  return { ok: true }
}
