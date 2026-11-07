/**
 * TekLive Rest · Impresión de venta (ronda cash/print) — réplica del flujo
 * silencioso del original (printing_service.dart + order_provider.dart):
 *
 *   Venta → printEscPosCreatedOrder(kitchen:true) [x2 si keywords L660-716]
 *         → printEscPosCreatedOrder(kitchen:false)
 *         → toast '✓ Orden procesada' + UI cerrada. NUNCA hay preview ni
 *           diálogo que detenga al cajero.
 *
 * En browser hoy: 1 solo printTicket() con TODOS los tickets concatenados
 * (cocina [+duplicado] + cliente) → 1 diálogo del sistema. En Tauri/APK
 * futuro: bytes ESC/POS por socket TCP 9100 silencioso (escpos.ts ya existe).
 *
 * Keywords de duplicado (L662-669): TENDERS, HAMBURGUESA, ELOTE, ELOTES,
 * ASADAS, PECHUGA — contra nombre de producto, extras, complementos y notas
 * (búsqueda parcial, upper-case).
 */

import type { CartItem } from '../../stores/cart'
import { buildItemNotes, cartItemUnitPrice } from '../../stores/cart'
import {
  buildKitchenTicket,
  buildClientTicket,
  printTicket,
  type TicketDoc,
} from './index'
import { logTicketPrint } from '../../api/rest'

/** Keywords réplica _orderNeedsDuplicateKitchenTicket (L662-669). */
const DUPLICATE_KEYWORDS = [
  'TENDERS', // TENDERS, TENDER
  'HAMBURGUESA', // HAMBURGUESA(S)
  'ELOTE', // ELOTE(S), ELOTERO
  'ELOTES',
  'ASADAS', // ALAS ASADAS / CORTES
  'PECHUGA',
] as const

/** true si la orden contiene productos clave → cocina se imprime x2. */
export function orderNeedsDuplicateKitchen(items: CartItem[]): boolean {
  for (const item of items) {
    const names = [
      item.productName,
      ...item.extras.map((e) => e.name),
      ...(item.complement != null ? [item.complement.name] : []),
      item.note ?? '',
    ]
    for (const name of names) {
      const upper = name.toUpperCase()
      if (DUPLICATE_KEYWORDS.some((k) => upper.includes(k))) return true
    }
    // Notas combinadas (OPT::/NOTE::) también cuentan (réplica L694-696).
    const notes = buildItemNotes(item)
    if (notes !== '') {
      const upper = notes.toUpperCase()
      if (DUPLICATE_KEYWORDS.some((k) => upper.includes(k))) return true
    }
  }
  return false
}

/** Estado PAGADO del ticket cliente (venta ya cobrada). */
export interface SalePaidState {
  paymentMethod: string
  amountReceived: number
  changeAmount: number
  dollarRate?: number
}

/** Entrada de impresión de venta (desde el snapshot del checkout). */
export interface SaleTicketInput {
  folio: string
  orderType: string
  /** Info de repartidor (UBER/DIDI) o nombre serializado (EXTERNO). */
  platformDeliveryInfo?: string | null
  items: CartItem[]
  total: number
  paidState?: SalePaidState | null
  /** Id real de la orden → print-log best-effort. */
  orderId?: number | null
}

/** Nombre de cliente réplica (switch order_panel.dart L1410-1426). */
function customerNameFor(orderType: string, platformDeliveryInfo?: string | null): string {
  const info = platformDeliveryInfo?.trim() ?? ''
  switch (orderType) {
    case 'EXTERNO':
      return info !== '' ? info : 'CLIENTE EXTERNO'
    case 'UBER/DIDI':
      return info !== '' ? info : 'UBER/DIDI'
    default:
      return 'CLIENTE LOCAL'
  }
}

function kitchenItems(items: CartItem[]) {
  return items.map((item) => ({
    quantity: item.quantity,
    productName: item.productName,
    notes: buildItemNotes(item),
    extras: item.extras.map((e) => e.name),
    complements: item.complement != null ? [item.complement.name] : [],
  }))
}

function clientItems(items: CartItem[]) {
  return items.map((item) => ({
    quantity: item.quantity,
    productName: item.productName,
    unitPrice: cartItemUnitPrice(item),
    notes: buildItemNotes(item),
    extras: item.extras.map((e) => e.name),
    complements: item.complement != null ? [item.complement.name] : [],
  }))
}

/**
 * Doc de SOLO cocina (para 'Guardar Orden' pendiente — el original imprime
 * únicamente el ticket de cocina al crear la orden pendiente, L374-388).
 * Incluye la 2ª copia si hay keywords (x2 con separación, réplica L335-342).
 */
export function buildPendingKitchenDoc(input: {
  folio: string
  orderType: string
  platformDeliveryInfo?: string | null
  items: CartItem[]
  total: number
}): TicketDoc {
  const base: TicketDoc = buildKitchenTicket({
    folio: input.folio,
    orderType: input.orderType,
    cashierName: 'CAJERO',
    customerName: customerNameFor(input.orderType, input.platformDeliveryInfo),
    platformDeliveryInfo: input.platformDeliveryInfo,
    items: kitchenItems(input.items),
    total: input.total,
  })
  if (!orderNeedsDuplicateKitchen(input.items)) return base
  // Copia duplicada: feed de separación + mismas líneas (réplica 1500ms).
  return { width: base.width, lines: [...base.lines, { kind: 'feed', n: 3 }, ...base.lines] }
}

/**
 * Doc completo de la venta: cocina (+duplicado si keywords) + cliente.
 * Un solo documento → un solo print en browser (los builders ya terminan
 * cada ticket con cut/feed, que separa en la térmica).
 */
export function buildSaleDoc(input: SaleTicketInput): TicketDoc {
  const kitchen = buildPendingKitchenDoc(input)
  const client = buildClientTicket({
    folio: input.folio,
    orderType: input.orderType,
    customerName: customerNameFor(input.orderType, input.platformDeliveryInfo),
    cashierName: 'CAJERO',
    items: clientItems(input.items),
    total: input.total,
    state: input.paidState
      ? {
          kind: 'paid',
          paymentMethod: input.paidState.paymentMethod,
          amountReceived: input.paidState.amountReceived,
          changeAmount: input.paidState.changeAmount,
          dollarRate: input.paidState.dollarRate,
        }
      : { kind: 'pending' },
  })
  return {
    width: kitchen.width,
    lines: [...kitchen.lines, { kind: 'feed', n: 2 }, ...client.lines],
  }
}

/** Print-log best-effort (no bloquea). */
async function logBoth(orderId: number | null | undefined): Promise<void> {
  if (orderId == null) return
  try {
    await logTicketPrint(orderId, { printType: 'kitchen', printerName: 'browser', success: true, errorMessage: null })
  } catch { /* best-effort */ }
  try {
    await logTicketPrint(orderId, { printType: 'client', printerName: 'browser', success: true, errorMessage: null })
  } catch { /* best-effort */ }
}

/**
 * Impresión de venta SILENCIOSA desde el punto de vista del cajero: no
 * abre previews ni modales. En browser dispara 1 diálogo con todos los
 * tickets; devuelve true si se lanzó.
 */
export function printSaleTickets(input: SaleTicketInput): boolean {
  const ok = printTicket(buildSaleDoc(input))
  void logBoth(input.orderId)
  return ok
}

/** Impresión SOLO cocina (pendientes) + print-log kitchen. */
export function printPendingKitchenTicket(input: {
  folio: string
  orderType: string
  platformDeliveryInfo?: string | null
  items: CartItem[]
  total: number
  orderId?: number | null
}): boolean {
  const ok = printTicket(buildPendingKitchenDoc(input))
  if (input.orderId != null) {
    try {
      void logTicketPrint(input.orderId, { printType: 'kitchen', printerName: 'browser', success: ok, errorMessage: ok ? null : 'print dialog failed' })
    } catch { /* best-effort */ }
  }
  return ok
}
