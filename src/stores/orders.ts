/**
 * TekLive Rest · Orders store (Fase 3b) — listado de pendientes + acciones.
 *
 * ⚠️ SWITCH MOCK → API REAL (QA ronda 3): flip mock→API real hecho
 *   (USE_MOCK = false). En `false`, las acciones llaman a los endpoints reales
 *   de src/api/rest.ts (createOrder / getOrders / getOrderDetail / payOrder /
 *   updateOrderStatus). El mock queda como fallback de desarrollo.
 *
 * Concurrencia: PATCH/POST payment llevan expectedStatus; un 409 con
 * `{ currentStatus }` significa que otro cajero ya cambió el estado → la UI
 * muestra el estado real y recarga la lista.
 */

import { defineStore } from 'pinia'
import { ApiError } from '../api/client'
import {
  createOrder,
  getOrderDetail,
  getOrders,
  payOrder,
  updateOrderStatus,
} from '../api/rest'
import type {
  CreatedOrderResponse,
  CreateOrderPayload,
  OrderDetail,
  OrderStatus,
  PaymentMethod,
  PaymentResponse,
  PendingOrderListItem,
} from '../api/pos-types'
import {
  createMockOrder,
  listMockOrders,
  payMockOrder,
  updateMockOrderStatus,
} from '../mocks/orders'

const USE_MOCK = false

export const useOrdersStore = defineStore('orders', {
  state: () => ({
    pendingOrders: [] as PendingOrderListItem[],
    loading: false,
    error: null as string | null,
    /** Última respuesta de conflicto de estado (409) para la UI. */
    lastConflict: null as { orderId: number; currentStatus: OrderStatus | 'not-found' } | null,
    /**
     * F7: cache del detalle REAL por orden (expandible de pendientes).
     * GET /orders/{id} → OrderDetail (unitPrice). Se pide una vez por orden.
     */
    detailCache: {} as Record<number, OrderDetail>,
    /** F5: error del último intento de detalle (el expandible lo muestra). */
    detailError: null as string | null,
  }),

  getters: {
    /**
     * Ronda 2 (réplica visual POS): badge del header del panel de orden.
     * Cuenta órdenes 'pendiente' del último fetch del panel (tab Pendientes).
     */
    pendingCount(state): number {
      return state.pendingOrders.filter((o) => o.orderStatus === 'pendiente').length
    },
  },

  actions: {
    /**
     * F7 (QA ronda 1): la lista del panel se pide CON filtro de status.
     * GET /orders sin filtro devuelve TODAS (pagadas/canceladas incluidas) y
     * el panel mostraba botones Cobrar/Cancelar sobre pagadas (409 ruidoso).
     *
     * El backend NO acepta lista separada por comas (compara
     * `ORDER_STATUS = @p4` exacto, ver RestOrderRepository.GetOrdersAsync) →
     * se hace UNA llamada por status y se une por id (sin duplicados).
     * El panel usa: tab "Pendientes" → ['pendiente'];
     * tab "En curso" → ['preparando', 'listo'].
     *
     * Ronda 2 (pantalla Órdenes del rail): `statuses = null` pide la lista
     * SIN filtro (réplica del dropdown "Todas" de pending_orders_screen.dart
     * L96-98: statusFilter = null). 'pagado' replica el filtro "Entregadas".
     */
    async fetchOrdersByStatus(plantId: number, date: string, statuses: string[] | null): Promise<void> {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        if (USE_MOCK) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          const wanted = statuses != null ? new Set(statuses) : null
          this.pendingOrders = listMockOrders().filter(
            (o) => wanted == null || wanted.has(o.orderStatus),
          )
        } else {
          const results =
            statuses == null
              ? [await getOrders({ plantId, date })]
              : await Promise.all(
                  statuses.map((status) => getOrders({ plantId, date, status })),
                )
          const byId = new Map<number, PendingOrderListItem>()
          for (const { data } of results) {
            for (const order of data) byId.set(order.id, order)
          }
          this.pendingOrders = [...byId.values()].sort((a, b) =>
            a.dailyOrderNumber - b.dailyOrderNumber,
          )
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
     * F5 (QA ronda 1): detalle REAL del expandible con caché por orden.
     * Reemplaza a getMockOrderDetail en el flujo de pendientes.
     * Devuelve el OrderDetail o null si falló (la UI muestra error local).
     */
    async fetchOrderDetail(orderId: number): Promise<OrderDetail | null> {
      const cached = this.detailCache[orderId]
      if (cached != null) return cached
      try {
        const { data } = await getOrderDetail(orderId)
        this.detailCache[orderId] = data
        return data
      } catch (err) {
        this.detailError =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar el detalle: ${err.message}`
            : 'No se pudo conectar con el servidor.'
        return null
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
      body: { method: PaymentMethod; amountReceived: number; expectedStatus: OrderStatus; cashSessionId?: number },
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
  },
})
