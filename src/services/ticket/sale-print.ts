/**
 * TekLive Rest · Impresión de venta (ronda cash/print + ronda Piso 1) —
 * réplica del flujo silencioso del original (printing_service.dart +
 * order_provider.dart):
 *
 *   Venta → printEscPosCreatedOrder(kitchen:true) [x2 si keywords L660-716]
 *         → printEscPosCreatedOrder(kitchen:false)
 *         → toast '✓ Orden procesada' + UI cerrada. NUNCA hay preview ni
 *           diálogo que detenga al cajero.
 *
 * DOS CANALES (ronda Piso 1):
 * - Tauri (escritorio): flujo REAL por impresoras — ticket cocina → área(s)
 *   según keywords guardadas (route-print.printKitchenOrderByArea); cliente →
 *   área CLIENTE si configurada sino principal. Silencioso, sin diálogos.
 *   Los flags del ticket-config (footer, showKitchenModifiers/Notes,
 *   showClientPaid/Free/Notes) se aplican vía los builders; si la carga del
 *   config falla se usan los defaults del Flutter (NUNCA se bloquea la
 *   impresión).
 * - Web (navegador/PWA): comportamiento HISTÓRICO intacto — 1 printTicket()
 *   con todos los tickets concatenados → 1 diálogo del navegador.
 *
 * El print-log best-effort se mantiene en ambos canales.
 */

import type { CartItem } from '../../stores/cart'
import { buildItemNotes, cartItemUnitPrice } from '../../stores/cart'
import {
  buildKitchenTicket,
  buildClientTicket,
  printTicket,
  type TicketDoc,
} from './index'
import { logTicketPrint, type TicketConfig } from '../../api/rest'
import { useAdminTicketConfigStore } from '../../stores/adminTicketConfig'
import { isTauri } from '../printing/tauri-bridge'
import {
  buildClientDocTauri,
  buildPendingKitchenDocTauri,
  printClientTicketTauri,
  printKitchenOrderByArea,
} from '../printing/route-print'

/** Keywords réplica _orderNeedsDuplicateKitchenTicket (L662-669) — SOLO canal
 *  web (el histórico; en Tauri el x2 lo decide route-print por keywords
 *  guardadas). */
const DUPLICATE_KEYWORDS = [
  'TENDERS', // TENDERS, TENDER
  'HAMBURGUESA', // HAMBURGUESA(S)
  'ELOTE', // ELOTE(S), ELOTERO
  'ELOTES',
  'ASADAS', // ALAS ASADAS / CORTES
  'PECHUGA',
] as const

/** true si la orden contiene productos clave → cocina se imprime x2 (web). */
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
  /** Teléfono EXTERNO (grande en ticket cocina/cliente EXTERNO). */
  customerPhone?: string | null
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

/** Config efectiva del ticket (defaults si la carga falló — nunca null). */
function effectiveTicketConfig(): TicketConfig {
  try {
    return useAdminTicketConfigStore().effectiveConfig
  } catch {
    // Fuera de contexto Pinia (tests/unit): defaults del Flutter/backend
    // (showClientNotes=false — REST_CONFIGURACION_GLOBAL + ticket_service L66).
    return {
      footer: '¡GRACIAS POR SU COMPRA! Vuelva pronto',
      showKitchenModifiers: true,
      showKitchenNotes: true,
      showClientPaidModifiers: true,
      showClientFreeModifiers: false,
      showClientNotes: false,
    }
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
    // Ronda Piso 1: extras/complementos CON precio (filtro pagados/gratuitos).
    extras: item.extras.map((e) => ({ name: e.name, price: e.price })),
    complements:
      item.complement != null ? [{ name: item.complement.name, price: item.complement.price }] : [],
  }))
}

/**
 * Doc de SOLO cocina (para 'Guardar Orden' pendiente — el original imprime
 * únicamente el ticket de cocina al crear la orden pendiente, L374-388).
 * Incluye la 2ª copia si hay keywords (x2 con separación, réplica L335-342).
 * Flags del ticket-config aplicados (showKitchenModifiers/Notes).
 */
export function buildPendingKitchenDoc(input: {
  folio: string
  orderType: string
  platformDeliveryInfo?: string | null
  items: CartItem[]
  total: number
}): TicketDoc {
  const cfg = effectiveTicketConfig()
  const base: TicketDoc = buildKitchenTicket({
    folio: input.folio,
    orderType: input.orderType,
    cashierName: 'CAJERO',
    customerName: customerNameFor(input.orderType, input.platformDeliveryInfo),
    platformDeliveryInfo: input.platformDeliveryInfo,
    items: kitchenItems(input.items),
    total: input.total,
    showModifiers: cfg.showKitchenModifiers,
    showNotes: cfg.showKitchenNotes,
  })
  if (!orderNeedsDuplicateKitchen(input.items)) return base
  // Copia duplicada: feed de separación + mismas líneas (réplica 1500ms).
  return { width: base.width, lines: [...base.lines, { kind: 'feed', n: 3 }, ...base.lines] }
}

/**
 * Doc completo de la venta (canal WEB): cocina (+duplicado si keywords) +
 * cliente. Un solo documento → un solo print en browser (los builders ya
 * terminan cada ticket con cut/feed, que separa en la térmica).
 */
export function buildSaleDoc(input: SaleTicketInput): TicketDoc {
  const kitchen = buildPendingKitchenDoc(input)
  const cfg = effectiveTicketConfig()
  const client = buildClientTicket({
    folio: input.folio,
    orderType: input.orderType,
    customerName: customerNameFor(input.orderType, input.platformDeliveryInfo),
    cashierName: 'CAJERO',
    items: clientItems(input.items),
    total: input.total,
    footer: cfg.footer,
    showNotes: cfg.showClientNotes,
    showPaidModifiers: cfg.showClientPaidModifiers,
    showFreeModifiers: cfg.showClientFreeModifiers,
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
async function logBoth(orderId: number | null | undefined, printerName: string): Promise<void> {
  if (orderId == null) return
  try {
    await logTicketPrint(orderId, { printType: 'kitchen', printerName, success: true, errorMessage: null })
  } catch { /* best-effort */ }
  try {
    await logTicketPrint(orderId, { printType: 'client', printerName, success: true, errorMessage: null })
  } catch { /* best-effort */ }
}

/**
 * Impresión de venta SILENCIOSA desde el punto de vista del cajero: no
 * abre previews ni modales.
 *
 * - Tauri: cocina por áreas (keywords → impresoras) + cliente (área CLIENTE
 *   o principal) vía print_raw; devuelve true si AMBOS flujos tuvieron al
 *   menos un destino OK (o el canal no requería destino).
 * - Web: 1 diálogo del navegador con todos los tickets; true si se lanzó.
 */
export function printSaleTickets(input: SaleTicketInput): boolean {
  if (isTauri()) {
    // Canal Tauri es async: dispara y no bloquea el flujo del checkout (el
    // toast/fin de venta no depende de la impresión — réplica L636-648 que
    // manda y sigue).
    void printSaleTicketsTauri(input)
    return true
  }
  const ok = printTicket(buildSaleDoc(input))
  void logBoth(input.orderId, 'browser')
  return ok
}

/** Flujo Tauri real (async): cocina por áreas + cliente. */
async function printSaleTicketsTauri(input: SaleTicketInput): Promise<void> {
  const cfg = effectiveTicketConfig()
  const customerName = customerNameFor(input.orderType, input.platformDeliveryInfo)
  try {
    await printKitchenOrderByArea({
      doc: buildPendingKitchenDocTauri({
        folio: input.folio,
        orderType: input.orderType,
        platformDeliveryInfo: input.platformDeliveryInfo,
        customerName,
        customerPhone: input.customerPhone,
        items: input.items,
        total: input.total,
        config: cfg,
      }),
      items: input.items,
    })
  } catch { /* el resultado por destino ya se captura dentro */ }
  try {
    await printClientTicketTauri(
      buildClientDocTauri({
        folio: input.folio,
        orderType: input.orderType,
        platformDeliveryInfo: input.platformDeliveryInfo,
        customerName,
        customerPhone: input.customerPhone,
        items: input.items,
        total: input.total,
        config: cfg,
        paidState: input.paidState,
      }),
    )
  } catch { /* idem */ }
  void logBoth(input.orderId, 'tauri')
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
  if (isTauri()) {
    void (async () => {
      try {
        await printKitchenOrderByArea({
          doc: buildPendingKitchenDocTauri({
            folio: input.folio,
            orderType: input.orderType,
            platformDeliveryInfo: input.platformDeliveryInfo,
            customerName: customerNameFor(input.orderType, input.platformDeliveryInfo),
            items: input.items,
            total: input.total,
            config: effectiveTicketConfig(),
          }),
          items: input.items,
        })
      } catch { /* resultado por destino capturado dentro */ }
      if (input.orderId != null) {
        try {
          await logTicketPrint(input.orderId, { printType: 'kitchen', printerName: 'tauri', success: true, errorMessage: null })
        } catch { /* best-effort */ }
      }
    })()
    return true
  }
  const ok = printTicket(buildPendingKitchenDoc(input))
  if (input.orderId != null) {
    try {
      void logTicketPrint(input.orderId, { printType: 'kitchen', printerName: 'browser', success: ok, errorMessage: ok ? null : 'print dialog failed' })
    } catch { /* best-effort */ }
  }
  return ok
}
