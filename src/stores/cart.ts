/**
 * TekLive Rest · Cart store (Fase 3a) — réplica EXACTA de OrderProvider de
 * CrazyWings (lib/providers/order_provider.dart):
 *
 * - addItem: dedup SOLO para items normales. Dos items son "idénticos" si
 *   coincide productId + complementId (si aplica) + extrasIds ordenados
 *   join(',') + note → quantity++ (match por ListEquality de Flutter).
 *   Si no hay match → item NUEVO con priceAtTimeOfAddition congelado
 *   (precio base + extras + complemento capturado al agregar).
 * - addDynamicItem: NUNCA dedup — siempre item nuevo con customPrice y el
 *   resumen de opciones en notes con sufijo legacy `OPT::Grupo:Valor`.
 * - setOrderType: al cambiar limpia customer / platformDeliveryInfo.
 * - total/subtotal: DISPLAY solamente — el backend RECALCULA al crear.
 *
 * Sin impuestos (CrazyWings: taxRate 0.0).
 */

import { defineStore } from 'pinia'
import type {
  OrderItemSelectedOption,
  OrderType,
  PaymentMethod,
} from '../api/pos-types'

// ---------------------------------------------------------------------------
// Tipos internos del carrito
// ---------------------------------------------------------------------------

export interface CartExtra {
  id: number
  name: string
  price: number
}

export interface CartComplement {
  id: number
  name: string
  price: number
}

export interface CartItem {
  /** Estable (uuid) para key de v-for y mutaciones. */
  readonly key: string
  productId: number
  productName: string
  quantity: number
  /** Precio congelado al agregar (base + extras + complemento, o customPrice). */
  readonly priceAtTimeOfAddition: number
  extras: CartExtra[]
  complement: CartComplement | null
  /** Nota del usuario (sin etiqueta). */
  note: string
  /** Resumen automático de opciones dinámicas (va a OPT::). Solo dinámicos. */
  dynamicOptionsSummary: string | null
  selectedOptions: OrderItemSelectedOption[] | null
}

let nextCartKey = 1

function makeCartKey(): string {
  return `ci-${nextCartKey++}`
}

/** Nota combinada que viaja al backend: OPT:: primero, NOTE:: después. */
export function buildItemNotes(item: CartItem): string {
  const parts: string[] = []
  const summary = item.dynamicOptionsSummary?.trim()
  if (summary != null && summary.length > 0) {
    parts.push(`OPT::${summary.replaceAll('\n', ' | ')}`)
  }
  const note = item.note.trim()
  if (note.length > 0) {
    parts.push(`NOTE::${note.replaceAll('\n', ' | ')}`)
  }
  return parts.join(' || ')
}

/** Item "dinámico" = creado con addDynamicItem (selectedOptions != null). */
function isDynamicItem(item: CartItem): boolean {
  return item.selectedOptions != null
}

/** Precio unitario total de un item (CrazyWings: totalItemPrice / quantity). */
function itemUnitPrice(item: CartItem): number {
  if (isDynamicItem(item)) return item.priceAtTimeOfAddition
  const extrasPrice = item.extras.reduce((sum, e) => sum + e.price, 0)
  const complementPrice = item.complement?.price ?? 0
  return item.priceAtTimeOfAddition + extrasPrice + complementPrice
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [] as CartItem[],
    orderType: 'LOCAL' as OrderType,
    /** Cliente para EXTERNO (ronda posterior: buscador de clientes). */
    customerId: null as number | null,
    /** Info de repartidor/folio para UBER/DIDI. */
    platformDeliveryInfo: '',
    placing: false,
  }),

  getters: {
    /** Total display (el backend recalcula). Sin impuestos. */
    subtotal(state): number {
      return state.items.reduce(
        (sum, item) => sum + itemUnitPrice(item) * item.quantity,
        0,
      )
    },

    total(): number {
      // CrazyWings: total = subtotal + tax (taxRate 0.0 → total = subtotal).
      return this.subtotal
    },

    itemCount(state): number {
      return state.items.reduce((n, item) => n + item.quantity, 0)
    },

    isEmpty(state): boolean {
      return state.items.length === 0
    },

    /**
     * Items agrupados para el resumen del checkout: nombre + qty por línea
     * de carrito (ya deduplicadas por addItem/addDynamicItem).
     */
    lines(state): CartItem[] {
      return state.items
    },
  },

  actions: {
    /**
     * Réplica de OrderProvider.addItem: dedup por
     * productId + complementId + extrasIds ordenados + note.
     * `basePrice` = precio base del template CONGELADO al agregar.
     */
    addItem(payload: {
      productId: number
      productName: string
      basePrice: number
      extras?: CartExtra[]
      complement?: CartComplement | null
      note?: string
    }): void {
      const extras = payload.extras ?? []
      const complement = payload.complement ?? null
      const note = payload.note ?? ''

      // Clave de dedup: extras IDs ordenados join(',') (ListEquality de Flutter).
      const extrasKey = extras
        .map((e) => e.id)
        .sort((a, b) => a - b)
        .join(',')

      const existing = this.items.find((item) => {
        if (isDynamicItem(item)) return false // dinámicos nunca deduplican
        const sameProduct = item.productId === payload.productId
        const sameComplement = (item.complement?.id ?? null) === (complement?.id ?? null)
        const itemExtrasKey = item.extras
          .map((e) => e.id)
          .sort((a, b) => a - b)
          .join(',')
        const sameExtras = itemExtrasKey === extrasKey
        const sameNote = item.note === note
        return sameProduct && sameComplement && sameExtras && sameNote
      })

      if (existing != null) {
        existing.quantity++
        return
      }

      // Item nuevo: precio congelado al agregar (base + extras + complemento).
      this.items.push({
        key: makeCartKey(),
        productId: payload.productId,
        productName: payload.productName,
        quantity: 1,
        priceAtTimeOfAddition: payload.basePrice,
        extras,
        complement,
        note,
        dynamicOptionsSummary: null,
        selectedOptions: null,
      })
      // NOTE: el precio unitario efectivo se computa en itemUnitPrice()
      // (base congelada + extras + complemento) igual que OrderItem Flutter.
    },

    /**
     * Réplica de OrderProvider.addDynamicItem: NUNCA dedup. Siempre crea un
     * item nuevo con customPrice (precio dinámico total por unidad) y el
     * resumen de opciones con sufijo legacy `OPT::Grupo:Valor`.
     */
    addDynamicItem(payload: {
      productId: number
      productName: string
      /** Precio dinámico total por unidad (base + modificadores). */
      totalPrice: number
      selectedOptions: OrderItemSelectedOption[]
      optionsSummary: string
      note?: string
    }): void {
      this.items.push({
        key: makeCartKey(),
        productId: payload.productId,
        productName: payload.productName,
        quantity: 1,
        priceAtTimeOfAddition: payload.totalPrice,
        extras: [],
        complement: null,
        note: payload.note ?? '',
        dynamicOptionsSummary: payload.optionsSummary,
        selectedOptions: payload.selectedOptions,
      })
    },

    incrementItem(key: string): void {
      const item = this.items.find((i) => i.key === key)
      if (item != null) item.quantity++
    },

    /** Réplica decrementItem: qty 1 → quitar la línea. */
    decrementItem(key: string): void {
      const item = this.items.find((i) => i.key === key)
      if (item == null) return
      if (item.quantity > 1) item.quantity--
      else this.removeItem(key)
    },

    removeItem(key: string): void {
      const index = this.items.findIndex((i) => i.key === key)
      if (index !== -1) this.items.splice(index, 1)
    },

    updateItemNote(key: string, note: string): void {
      const item = this.items.find((i) => i.key === key)
      if (item != null) item.note = note
    },

    /**
     * Réplica setOrderType: al cambiar, limpia customer (EXTERNO) y
     * platform info (UBER/DIDI). TRANSFER_P1_P2 fuerza limpieza total.
     */
    setOrderType(type: OrderType): void {
      if (this.orderType === type) return
      this.orderType = type
      if (type !== 'EXTERNO') this.customerId = null
      if (type !== 'UBER' && type !== 'DIDI') this.platformDeliveryInfo = ''
    },

    setPlatformDeliveryInfo(info: string): void {
      this.platformDeliveryInfo = info
    },

    /** Limpia el carrito tras venta/pendiente exitoso (o descarte). */
    clear(): void {
      this.items = []
      this.orderType = 'LOCAL'
      this.customerId = null
      this.platformDeliveryInfo = ''
      this.placing = false
    },

    /**
     * Gate de caja abierta — TODO(cash-round-2): aquí se enchufará el check
     * de sesión de caja (useCashSessionStore.currentSession != null) para
     * bloquear venta/pendiente sin sesión. Ronda 1: siempre permite vender.
     */
    get canSell(): boolean {
      return true // TODO(cash-round-2): gate real con sesión de caja
    },

    /**
     * Payload de items para POST /api/rest/orders (forma del contrato).
     * El backend recalcula precios/totales: esto es DISPLAY + estructura.
     * Los campos _unitPrice/_productName son auxiliares del MOCK (Fase 3b);
     * el backend real los ignora (calculated server-side desde productId).
     */
    toOrderItems(): Array<{
      productId: number
      quantity: number
      notes?: string
      extras: Array<{ extraId: number }>
      complements: Array<{ idcomp: number }>
      selectedOptions?: OrderItemSelectedOption[]
      _unitPrice?: number
      _productName?: string
    }> {
      return this.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        notes: buildItemNotes(item) || undefined,
        extras: item.extras.map((e) => ({ extraId: e.id })),
        complements: item.complement != null ? [{ idcomp: item.complement.id }] : [],
        ...(isDynamicItem(item) ? { selectedOptions: item.selectedOptions ?? [] } : {}),
        _unitPrice: itemUnitPrice(item),
        _productName: item.productName,
      }))
    },
  },
})

/** Helper exportado para tests/QA: precio unitario efectivo de un item. */
export function cartItemUnitPrice(item: CartItem): number {
  return itemUnitPrice(item)
}

/** Método de pago del checkout (re-export para cohesión de imports). */
export type CheckoutPaymentMethod = Extract<PaymentMethod, 'efectivo' | 'tarjeta' | 'ambos'>
