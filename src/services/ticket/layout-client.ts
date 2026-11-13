/**
 * TekLive Rest · Ticket cliente — réplica EXACTA de _buildEscPosClientTicket
 * (printing_service.dart L925-1242 de CrazyWings, variante sin logo).
 *
 * Flujo del original:
 *   feed 1 → hr → fiscales centrados (RFC / dirección / Tel) → hr
 *   → tipoOrden centrado bold (+TEL grande si EXTERNO) → hr
 *   → row ORDEN #(folio doble-bold centro) FECHA → row HORA / CLIENTE:
 *   → 'CAJERO: X' bold si existe → hr
 *   → 'CANT DESCRIPCION        TOTAL' → hr
 *   → items '2x nombre ... $total' (+extras/comp SOLO sin nota, + notas parseadas)
 *   → hr → 'Subtotal $X' derecha → 'TOTAL $X' derecha DOBLE → hr
 *   → estado: preBill 'CUENTA SOLICITADA'+'PAGO EN CAJA' / pendiente
 *     'PENDIENTE DE PAGO' / pagado 'PAGADO - METODO' + Monto + Cambio → hr
 *   → '¡GRACIAS POR SU COMPRA!' / 'Vuelva pronto' / 'Crazzy Wings Las Torres'
 *   → feed 3 + cut + feed 1.
 */

import { TICKET_WIDTH_80MM, type TicketDoc, type TicketLine } from './types'
import { buildNoteLines } from './layout-kitchen'

/** Item de entrada para el ticket del cliente. */
export interface ClientTicketItem {
  quantity: number
  productName: string
  /** Precio UNITARIO con opciones (item.price del Flutter). */
  unitPrice: number
  notes?: string | null
  /**
   * Ronda Piso 1: extras/complementos CON PRECIO (para el filtro
   * showClientPaid/FreeModifiers réplica _buildProductDetails L856-908: el
   * original del cliente imprime cada modificador en su propia línea '+ X
   * $P'). El nombre limpio (_displayModifierName) se aplica al render.
   */
  extras?: ClientTicketModifier[]
  complements?: ClientTicketModifier[]
}

/** Modificador con precio (extra/complemento del carrito). */
export interface ClientTicketModifier {
  name: string
  price: number
}

/** Estado de la orden para el bloque final (L1146-1214). */
export type ClientTicketState =
  | { kind: 'preBill' }
  | { kind: 'pending' }
  | {
      kind: 'paid'
      /** Método YA normalizado para display (EFECTIVO/TARJETA/QR/DOLARES...). */
      paymentMethod: string
      amountReceived: number
      /** changeAmount del backend; null → clamp(recibido − total). */
      changeAmount?: number | null
      /** Tasa USD para el cambio de DOLARES (default 20 como el original). */
      dollarRate?: number
    }

export interface ClientTicketInput {
  folio: string
  orderType: string
  /** Cliente mostrado (EXTERNO nombre / LOCAL 'CLIENTE LOCAL'). */
  customerName?: string | null
  /** Teléfono EXTERNO en grande si existe (L1000-1013). */
  customerPhone?: string | null
  cashierName?: string | null
  items: ClientTicketItem[]
  total: number
  createdAt?: Date
  state: ClientTicketState
  /**
   * Ronda Piso 1 — footer configurable (ticket_service.dart L31: default
   * '¡GRACIAS POR SU COMPRA! Vuelva pronto'). El 'Crazzy Wings Las Torres'
   * del footer se mantiene fijo como el original.
   */
  footer?: string | null
  /** Ronda Piso 1 — flags del ticket-config (L793): notas del cliente. */
  showNotes?: boolean
  /** Modificadores con precio > 0 (L859). */
  showPaidModifiers?: boolean
  /** Modificadores gratuitos precio ≤ 0; los negativos SIEMPRE (L860). */
  showFreeModifiers?: boolean
}

/** Réplica _displayModifierName (L1326-1328): '_' y '-' → espacio, trim. */
function displayModifierName(name: string): string {
  return name.replaceAll(/[_-]/g, ' ').trim()
}

/**
 * Réplica _isNegativeModifierName (regla del filtro L860: los modificadores
 * "negativos" 'sin X'/'no X'/'-X' se muestran SIEMPRE aunque showFreeModifiers
 * sea false — comunican al cliente lo que se le quitó).
 */
function isNegativeModifierName(name: string): boolean {
  const lower = name.toLowerCase().trim()
  return lower.startsWith('sin ') || lower.startsWith('no ') || lower.startsWith('-')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatHhMmSs(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDdMmYyyy(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Réplica _getPaymentMethodDisplay (L1245-1265): normalización a display. */
export function getPaymentMethodDisplay(method: string | null | undefined): string {
  if (method == null || method === '') return 'EFECTIVO'
  const normalized = method.toUpperCase().trim()
  switch (normalized) {
    case 'EFECTIVO':
    case 'CASH':
      return 'EFECTIVO'
    case 'TARJETA':
    case 'CARD':
    case 'CREDITO':
    case 'DÉBITO':
      return 'TARJETA'
    case 'QR':
    case 'TRANSFER':
    case 'TRANSFERENCIA':
      return 'QR'
    default:
      return normalized
  }
}

export function buildClientTicket(input: ClientTicketInput): TicketDoc {
  const lines: TicketLine[] = []
  const createdAt = input.createdAt ?? new Date()
  const tipoOrden = (input.orderType ?? 'LOCAL').toUpperCase()
  // Ronda Piso 1: flags del ticket-config (defaults del builder: pagados sí,
  // gratuitos no, notas sí — showClientNotes el STORE resuelve a false, que es
  // el default real backend/Flutter; el caller siempre lo pasa explícito).
  const showNotes = input.showNotes ?? true
  const showPaidModifiers = input.showPaidModifiers ?? true
  const showFreeModifiers = input.showFreeModifiers ?? false
  const footerMessage = input.footer ?? '¡GRACIAS POR SU COMPRA! Vuelva pronto'

  // ===== FISCALES (L961-985) =====
  lines.push({ kind: 'feed', n: 1 })
  lines.push({ kind: 'hr' })
  lines.push({ kind: 'text', text: 'RFC. GARA8210125T5', align: 'center' })
  lines.push({ kind: 'text', text: 'Praderas del Encino #8631-38,32695,Juarez,Chih.', align: 'center' })
  lines.push({ kind: 'text', text: 'Tel: 656-409-0371', align: 'center' })
  lines.push({ kind: 'hr' })

  // ===== TIPO DE ORDEN (L989-1015) =====
  lines.push({ kind: 'text', text: tipoOrden, align: 'center', bold: true })
  if (tipoOrden === 'EXTERNO' && input.customerPhone != null && input.customerPhone !== '') {
    lines.push({ kind: 'text', text: `TEL: ${input.customerPhone}`, align: 'center', bold: true })
  }
  lines.push({ kind: 'hr' })

  // ===== INFO DEL TICKET (L1017-1056) =====
  // Row de 3 columnas en el Flutter (4/4/4): 'ORDEN  #' normal, folio DOBLE
  // bold al centro, 'FECHA ...' normal a la derecha.
  lines.push({ kind: 'row', left: 'ORDEN  #', right: `FECHA  ${formatDdMmYyyy(createdAt)}` })
  lines.push({ kind: 'text', text: `#${input.folio}`, align: 'center', bold: true, double: true })
  lines.push({
    kind: 'row',
    left: `HORA  ${formatHhMmSs(createdAt)}`,
    right: `CLIENTE:  ${input.customerName ?? 'CLIENTE LOCAL'}`,
  })
  if (input.cashierName != null && input.cashierName !== '') {
    lines.push({ kind: 'text', text: `CAJERO: ${input.cashierName}`, align: 'left', bold: true })
  }
  lines.push({ kind: 'hr' })

  // ===== ITEMS (L1058-1116) =====
  lines.push({ kind: 'text', text: 'CANT DESCRIPCION        TOTAL', align: 'left' })
  lines.push({ kind: 'hr' })

  for (const item of input.items) {
    const description = `${item.quantity}x ${item.productName}`
    const lineTotal = (item.unitPrice * item.quantity).toFixed(2)
    lines.push({ kind: 'row', left: description, right: `$${lineTotal}` })

    const hasNote = item.notes != null && item.notes !== ''
    // Extras/Complementos SOLO si no hay nota (L1085-1109), CADA modificador
    // en su línea '+ X $P' filtrado por los flags (réplica L856-908).
    if (!hasNote) {
      for (const extra of item.extras ?? []) {
        const show =
          (extra.price > 0 && showPaidModifiers) ||
          (extra.price <= 0 && (showFreeModifiers || isNegativeModifierName(extra.name)))
        if (!show) continue
        lines.push({
          kind: 'row',
          left: `+ ${displayModifierName(extra.name)}`,
          right: `$${extra.price.toFixed(2)}`,
        })
      }
      for (const comp of item.complements ?? []) {
        const show =
          (comp.price > 0 && showPaidModifiers) ||
          (comp.price <= 0 && (showFreeModifiers || isNegativeModifierName(comp.name)))
        if (!show) continue
        lines.push({
          kind: 'row',
          left: `+ ${displayModifierName(comp.name)}`,
          right: `$${comp.price.toFixed(2)}`,
        })
      }
    }
    // Notas parseadas (OPT::/NOTE::) igual que cocina (L1112-1115) —
    // filtradas por showClientNotes (L839-840).
    if (showNotes) {
      for (const noteLine of buildNoteLines(item.notes)) {
        lines.push({ kind: 'text', text: noteLine, align: 'left' })
      }
    }
  }
  lines.push({ kind: 'hr' })

  // ===== RESUMEN (L1120-1142): texto alineado derecha con espaciado fijo
  // ('Subtotal                 $X' / 'TOTAL                    $X'),
  // TOTAL en DOBLE (height2+width2 L1134-1142).
  lines.push({
    kind: 'text',
    text: `Subtotal                 $${input.total.toFixed(2)}`,
    align: 'right',
  })
  lines.push({
    kind: 'text',
    text: `TOTAL                    $${input.total.toFixed(2)}`,
    align: 'right',
    double: true,
  })
  lines.push({ kind: 'hr' })

  // ===== ESTADO / MÉTODO (L1146-1214) =====
  if (input.state.kind === 'preBill') {
    lines.push({ kind: 'text', text: 'CUENTA SOLICITADA', align: 'center', bold: true })
    lines.push({ kind: 'text', text: 'PAGO EN CAJA', align: 'center', bold: true })
  } else if (input.state.kind === 'pending') {
    lines.push({ kind: 'text', text: 'PENDIENTE DE PAGO', align: 'center', bold: true })
  } else {
    const paymentMethod = getPaymentMethodDisplay(input.state.paymentMethod)
    lines.push({ kind: 'text', text: `PAGADO - ${paymentMethod}`, align: 'center' })
    lines.push({ kind: 'feed', n: 1 })
    lines.push({ kind: 'text', text: `Monto Pagado: $${input.state.amountReceived.toFixed(2)}`, align: 'center' })

    const changeAmount = input.state.changeAmount
      ?? Math.max(0, input.state.amountReceived - input.total)
    if (changeAmount >= 0.01) {
      if (paymentMethod.includes('DOLARES')) {
        // DOLARES: cambio en USD + MXN (tasa default 20 como el original L1198).
        const dollarRate = input.state.dollarRate ?? 20
        const dollarChange = changeAmount / dollarRate
        lines.push({
          kind: 'text',
          text: `Cambio: $${dollarChange.toFixed(2)} USD ($${changeAmount.toFixed(2)} MXN)`,
          align: 'center',
        })
      } else {
        lines.push({ kind: 'text', text: `Cambio: $${changeAmount.toFixed(2)}`, align: 'center' })
      }
    }
  }
  lines.push({ kind: 'hr' })

  // ===== FOOTER (L1218-1239): mensaje configurable (L31) + tienda fija =====
  // El footer puede traer varias líneas separadas por \n (≤200 chars).
  for (const footerLine of footerMessage.split('\n')) {
    if (footerLine.trim() !== '') {
      lines.push({ kind: 'text', text: footerLine, align: 'center' })
    }
  }
  lines.push({ kind: 'text', text: 'Crazzy Wings Las Torres', align: 'center' })
  lines.push({ kind: 'feed', n: 3 })
  lines.push({ kind: 'cut' })
  lines.push({ kind: 'feed', n: 1 })

  return { width: TICKET_WIDTH_80MM, lines }
}
