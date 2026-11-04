/**
 * TekLive Rest · Orders store (Fase 3b) — listado de pendientes + acciones.
 *
 * ⚠️ SWITCH MOCK → API REAL (QA ronda 3):
 *   `USE_MOCK` abajo. En `false`, las acciones llaman a los endpoints reales
 *   de src/api/rest.ts (createOrder / getOrders / payOrder / updateOrderStatus).
 *   Mientras el backend no exista, dejar en `true`.
 *
 * Concurrencia: PATCH/POST payment llevan expectedStatus; un 409 con
 * `{ currentStatus }` significa que otro cajero ya cambió el estado → la UI
 * muestra el estado real y recarga la lista.
 */

import { defineStore } from 'pinia'
import { ApiError } from '../api/client'
import {
  createOrder,
  getOrders,
  payOrder,
  updateOrderStatus,
} from '../api/rest'
import type {
  CreatedOrderResponse,
  CreateOrderPayload,
  OrderStatus,
  PaymentMethod,
  PaymentResponse,
  PendingOrderListItem,
} from '../api/pos-types'
import {
  createMockOrder,
  getMockOrder,
  listMockOrders,
  payMockOrder,
  updateMockOrderStatus,
  type MockOrder,
} from '../mocks/orders'

const USE_MOCK = true

export const useOrdersStore = defineStore('orders', {
  state: () => ({
    pendingOrders: [] as PendingOrderListItem[],
    loading: false,
    error: null as string | null,
    /** Última respuesta de conflicto de estado (409) para la UI. */
    lastConflict: null as { orderId: number; currentStatus: OrderStatus | 'not-found' } | null,
  }),

  actions: {
    /**
     * GET /orders?plantId=&date= — lista de órdenes activas del día.
     * SIN filtro de status: el panel del POS necesita ver pendiente +
     * preparando + listo para avanzarlas por etapas (réplica del filtro
     * "Pendiente/Entregadas/Todas" de pending_orders_screen.dart).
     * El polling externo (15s) llama aquí.
     */
    async fetchPendingOrders(plantId: number, date: string): Promise<void> {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        if (USE_MOCK) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          // Mock: excluye pagadas/canceladas (órdenes activas).
          this.pendingOrders = listMockOrders().filter(
            (o) => o.orderStatus !== 'pagado' && o.orderStatus !== 'cancelada',
          )
        } else {
          const { data } = await getOrders({ plantId, date })
          this.pendingOrders = data
        }
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar órdenes: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
      } finally {
        this.loading = false
      }
    },

    /**
     * POST /orders — crea orden (payment presente = venta, ausente = pendiente).
     * Devuelve la respuesta creada (folio, total backend, cambio si venta).
     */
    async submitOrder(body: CreateOrderPayload, waiterName: string): Promise<CreatedOrderResponse> {
      if (USE_MOCK) {
        // El mock recalcula el total desde los items (como el backend real).
        // Los campos _unitPrice/_productName viajan adjuntos solo en mock
        // (el backend real los ignora: recalcula desde productId/optionIds).
        const mockItems = body.items.map((it) => {
          const extra = it as { _unitPrice?: number; _productName?: string }
          return {
            productName: extra._productName ?? `Producto ${it.productId}`,
            unitPrice: extra._unitPrice ?? 0,
            quantity: it.quantity,
            notes: it.notes,
          }
        })
        return createMockOrder({
          waiterName,
          payment: body.payment,
          items: mockItems.length > 0 ? mockItems : [{ productName: '?', unitPrice: 0, quantity: 1 }],
        })
      }
      const { status, data } = await createOrder(body)
      if (status !== 201) {
        throw new ApiError(status, 'El backend no devolvió 201 al crear la orden.')
      }
      return data
    },

    /**
     * POST /orders/{id}/payment — cobra. 409 → lastConflict con currentStatus.
     * Devuelve PaymentResponse o null si hubo conflicto (la UI muestra banner).
     */
    async payExistingOrder(
      orderId: number,
      body: { method: PaymentMethod; amountReceived: number; expectedStatus: OrderStatus },
    ): Promise<PaymentResponse | null> {
      this.lastConflict = null
      try {
        if (USE_MOCK) {
          const result = payMockOrder(orderId, body)
          if (result.ok) return result.data
          this.lastConflict = { orderId, currentStatus: result.conflictStatus }
          return null
        }
        const { data } = await payOrder(orderId, body)
        return data
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          this.lastConflict = { orderId, currentStatus: this.readConflictStatus(err) }
          return null
        }
        throw err
      }
    },

    /**
     * PATCH /orders/{id}/status — avanza estado. 409 → lastConflict.
     * Devuelve true si avanzó, null en conflicto.
     */
    async advanceOrder(
      orderId: number,
      body: { expectedStatus: OrderStatus; newStatus: OrderStatus; notes?: string },
    ): Promise<boolean | null> {
      this.lastConflict = null
      try {
        if (USE_MOCK) {
          const result = updateMockOrderStatus(orderId, body)
          if (result.ok) return true
          this.lastConflict = { orderId, currentStatus: result.conflictStatus }
          return null
        }
        await updateOrderStatus(orderId, body)
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          this.lastConflict = { orderId, currentStatus: this.readConflictStatus(err) }
          return null
        }
        throw err
      }
    },

    /** 403 en cancelación (rol sin permiso) — el caller la maneja. */
    readConflictStatus(err: ApiError): OrderStatus | 'not-found' {
      try {
        const parsed = JSON.parse(err.message) as { currentStatus?: OrderStatus }
        if (parsed.currentStatus != null) return parsed.currentStatus
      } catch {
        // message no era JSON; razón genérica abajo.
      }
      return 'not-found'
    },

    /** Detalle mock para el expandible de pendientes (solo USE_MOCK). */
    getMockOrderDetail(orderId: number): MockOrder | undefined {
      return getMockOrder(orderId)
    },
  },
})
