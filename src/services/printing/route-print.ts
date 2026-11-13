/**
 * TekLive Rest · Routing de impresión Tauri (ronda Piso 1) — réplica de
 * printing_service.dart de CrazyWings:
 *
 * - printEscPosCreatedOrder(kitchen:true) → _printKitchenOrderByArea
 *   (L490-545): keywords por área → impresoras kitchen_<AREA>_ip; sin
 *   coincidencias → impresora principal (L536-544).
 * - printKitchenTicketToBothPrinters (L590-644): doble cocina K1/K2 con
 *   resultado { kitchen1Ok, kitchen2Ok, messages } (KitchenPrintResult).
 * - validatePrinterReadiness (L80-148): probe TCP antes de mandar.
 * - Cliente (kitchen:false): área CLIENTE si configurada, sino principal.
 *
 * Bytes: ticketToEscPosBytes (escpos.ts) sobre los builders configurables.
 * Envío: print_raw del shell Tauri (Winspool RAW) para USB/nombre Windows;
 * el shell también resuelve la térmica de red — el probe 9100 es el filtro
 * de readiness (un host que no responde 9100 no imprimirá RAW).
 */

import type { CartItem } from '../../stores/cart'
import { buildItemNotes, cartItemUnitPrice } from '../../stores/cart'
import {
  buildKitchenTicket,
  buildClientTicket,
  ticketToEscPosBytes,
  type TicketDoc,
} from '../ticket'
import { isTauri, printRawEscPos, probePrinter } from './tauri-bridge'
import {
  getAreaPrinter,
  getKitchenSlot,
  getMainPrinter,
  loadKeywords,
  normalizePrinterArea,
  PRINT_AREAS,
  type ProductKeyword,
} from './printer-config'
import type { TicketConfig } from '../../api/rest'

/** Resultado réplica KitchenPrintResult (printing_service L33-48). */
export interface KitchenPrintResult {
  kitchen1Ok: boolean
  kitchen2Ok: boolean
  kitchen1Message: string
  kitchen2Message: string
}

/** Resultado del enrutado por área de una impresión de cocina en Tauri. */
export interface AreaPrintResult {
  /** true si al menos un destino recibió el ticket (o no había destinos). */
  ok: boolean
  messages: string[]
}

// ---------------------------------------------------------------------------
// Keywords → áreas (réplica _loadPrinterAreaKeywords L804-825 +
// _detectPrinterAreasForItem L827-850)
// ---------------------------------------------------------------------------

/**
 * Áreas detectadas para un item: nombre de producto + extras + complementos +
 * nota (upper-case, búsqueda parcial). Las keywords de área CLIENTE NO
 * enrutan a cocina (L843-845: solo se agregan áreas != 'CLIENTE').
 */
function detectPrinterAreasForItem(item: CartItem, keywords: ProductKeyword[]): Set<string> {
  const areas = new Set<string>()
  const texts = [
    item.productName.toUpperCase(),
    ...item.extras.map((extra) => extra.name.toUpperCase()),
    ...(item.complement != null ? [item.complement.name.toUpperCase()] : []),
    ...(item.note != null && item.note !== '' ? [item.note.toUpperCase()] : []),
  ]
  for (const text of texts) {
    if (text === '') continue
    for (const keyword of keywords) {
      if (text.includes(keyword.keyword.toUpperCase())) {
        if (keyword.printerArea !== 'CLIENTE') areas.add(keyword.printerArea)
      }
    }
  }
  return areas
}

/**
 * ¿La orden necesita cocina duplicada? YA no usa las keywords hardcoded
 * (TENDERS/HAMBURGUESA/...): son las keywords guardadas por el admin contra
 * el área COCINA — el admin marca qué productos son de cocina y x2 réplica
 * _orderNeedsDuplicateKitchenTicket (L660-716).
 */
export function orderNeedsDuplicateKitchen(items: CartItem[]): boolean {
  const keywords = loadKeywords().filter((k) => k.printerArea === 'COCINA')
  if (keywords.length === 0) return false
  return items.some((item) => detectPrinterAreasForItem(item, keywords).size > 0)
}

// ---------------------------------------------------------------------------
// Builders (mismos helpers que sale-print.ts — kitchen/client items)
// ---------------------------------------------------------------------------

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
    extras: item.extras.map((e) => ({ name: e.name, price: e.price })),
    complements:
      item.complement != null ? [{ name: item.complement.name, price: item.complement.price }] : [],
  }))
}

/** Doc de SOLO cocina (+duplicado si keywords COCINA, réplica L335-342). */
export function buildPendingKitchenDocTauri(input: {
  folio: string
  orderType: string
  platformDeliveryInfo?: string | null
  customerName?: string | null
  customerPhone?: string | null
  items: CartItem[]
  total: number
  config?: TicketConfig | null
}): TicketDoc {
  const cfg = input.config
  const base: TicketDoc = buildKitchenTicket({
    folio: input.folio,
    orderType: input.orderType,
    cashierName: 'CAJERO',
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    platformDeliveryInfo: input.platformDeliveryInfo,
    items: kitchenItems(input.items),
    total: input.total,
    showModifiers: cfg?.showKitchenModifiers ?? true,
    showNotes: cfg?.showKitchenNotes ?? true,
  })
  if (!orderNeedsDuplicateKitchen(input.items)) return base
  return { width: base.width, lines: [...base.lines, { kind: 'feed', n: 3 }, ...base.lines] }
}

/** Doc cliente configurable (footer + flags showClient*). */
export function buildClientDocTauri(input: {
  folio: string
  orderType: string
  platformDeliveryInfo?: string | null
  customerName?: string | null
  customerPhone?: string | null
  items: CartItem[]
  total: number
  config?: TicketConfig | null
  paidState?: {
    paymentMethod: string
    amountReceived: number
    changeAmount: number
    dollarRate?: number
  } | null
}): TicketDoc {
  const cfg = input.config
  return buildClientTicket({
    folio: input.folio,
    orderType: input.orderType,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    cashierName: 'CAJERO',
    items: clientItems(input.items),
    total: input.total,
    footer: cfg?.footer ?? null,
    showNotes: cfg?.showClientNotes ?? true,
    showPaidModifiers: cfg?.showClientPaidModifiers ?? true,
    showFreeModifiers: cfg?.showClientFreeModifiers ?? false,
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
}

// ---------------------------------------------------------------------------
// Envío (réplica _printTicketToPrinter L686-770 + readiness L80-148)
// ---------------------------------------------------------------------------

/** Probe de readiness réplica validatePrinterReadiness: red → 9100, USB → true. */
async function validatePrinterReadiness(
  printer: { ip: string; isUsb: boolean },
): Promise<{ isReady: boolean; message: string }> {
  if (printer.isUsb) {
    // USB no se puede sondear por TCP; el fallo real lo reporta print_raw.
    return { isReady: true, message: 'Impresora USB lista' }
  }
  try {
    const ok = await probePrinter(printer.ip, 9100, 2000)
    return { isReady: ok, message: ok ? 'Impresora de red lista' : `La impresora de red (${printer.ip}) no responde. Verifica que esté encendida y en la red.` }
  } catch (e) {
    return { isReady: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** Envía bytes a UN destino (USB → print_raw nombre; red → print_raw IP). */
async function sendBytesToPrinter(
  bytes: Uint8Array,
  printer: { ip: string; isUsb: boolean },
): Promise<void> {
  await printRawEscPos(printer.ip, bytes)
}

// ---------------------------------------------------------------------------
// API pública: cocina por áreas, doble cocina, cliente
// ---------------------------------------------------------------------------

/**
 * Réplica _printKitchenOrderByArea (L490-545): un solo ticket completo de
 * cocina → una copia por CADA área detectada con impresora configurada.
 * Sin áreas/impresoras → fallback a la principal (L536-544); sin principal →
 * ok=false con mensaje (el caller decide toast).
 */
export async function printKitchenOrderByArea(input: {
  doc: TicketDoc
  items: CartItem[]
}): Promise<AreaPrintResult> {
  const messages: string[] = []
  if (!isTauri()) {
    return { ok: false, messages: ['La impresión directa solo está disponible en la app de escritorio.'] }
  }

  const bytes = ticketToEscPosBytes(input.doc)
  const keywords = loadKeywords()
  const printerAreas = new Set<string>()
  for (const item of input.items) {
    for (const area of detectPrinterAreasForItem(item, keywords)) printerAreas.add(area)
  }

  let sentAny = false
  for (const area of printerAreas) {
    const printer = getAreaPrinter(area)
    if (printer == null) {
      messages.push(`Se detectó el área "${area}", pero no hay una impresora guardada para esa área.`)
      continue
    }
    const readiness = await validatePrinterReadiness(printer)
    if (!readiness.isReady) {
      messages.push(`Área ${area}: ${readiness.message}`)
      continue
    }
    try {
      await sendBytesToPrinter(bytes, printer)
      messages.push(`Área ${area} → ${printer.ip} OK`)
      sentAny = true
    } catch (e) {
      messages.push(`Área ${area}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (printerAreas.size === 0) {
    // Fallback principal (L536-544): sin coincidencias → impresora principal.
    const main = getMainPrinter()
    if (main == null || main.ip.trim() === '') {
      messages.push('No hay impresora principal configurada para los productos sin área.')
      return { ok: false, messages }
    }
    const readiness = await validatePrinterReadiness(main)
    if (!readiness.isReady) {
      messages.push(readiness.message)
      return { ok: false, messages }
    }
    try {
      await sendBytesToPrinter(bytes, main)
      messages.push(`Cocina → principal (${main.ip}) OK`)
      sentAny = true
    } catch (e) {
      messages.push(`Principal: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false, messages }
    }
  }

  return { ok: sentAny, messages }
}

/**
 * Réplica printKitchenTicketToBothPrinters (L590-644): el ticket de cocina a
 * K1 y K2 con 800ms entre envíos. Una cocina no configurada se reporta como
 * fallo SIN bloquear la otra.
 */
export async function printKitchenTicketToBothPrinters(doc: TicketDoc): Promise<KitchenPrintResult> {
  const bytes = ticketToEscPosBytes(doc)
  const k1 = getKitchenSlot(1)
  const k2 = getKitchenSlot(2)

  const sendOne = async (
    slot: KitchenPrintResult extends never ? never : 1 | 2,
  ): Promise<{ ok: boolean; message: string }> => {
    const cfg = slot === 1 ? k1 : k2
    if (cfg == null || cfg.ip.trim() === '') {
      return { ok: false, message: `Cocina ${slot} sin configurar` }
    }
    try {
      await printRawEscPos(cfg.ip, bytes)
      return { ok: true, message: `Cocina ${slot} OK (${cfg.ip})` }
    } catch (e) {
      return { ok: false, message: `Cocina ${slot} falló: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  const r1 = await sendOne(1)
  // Pequeña pausa entre impresoras para no saturar el spooler/red (L632).
  await new Promise((resolve) => setTimeout(resolve, 800))
  const r2 = await sendOne(2)

  return {
    kitchen1Ok: r1.ok,
    kitchen2Ok: r2.ok,
    kitchen1Message: r1.message,
    kitchen2Message: r2.message,
  }
}

/**
 * Réplica del flujo cliente (kitchen:false, L385-487): área CLIENTE si
 * configurada, sino impresora principal. try/catch individual.
 */
export async function printClientTicketTauri(doc: TicketDoc): Promise<AreaPrintResult> {
  const messages: string[] = []
  if (!isTauri()) {
    return { ok: false, messages: ['La impresión directa solo está disponible en la app de escritorio.'] }
  }
  const bytes = ticketToEscPosBytes(doc)
  const client = getAreaPrinter('CLIENTE')
  const main = getMainPrinter()
  const target = client ?? main
  if (target == null || target.ip.trim() === '') {
    messages.push('⚠️ Impresora no configurada. Configúrala en Ajustes > Impresoras.')
    return { ok: false, messages }
  }
  const readiness = await validatePrinterReadiness(target)
  if (!readiness.isReady) {
    messages.push(readiness.message)
    return { ok: false, messages }
  }
  try {
    await sendBytesToPrinter(bytes, target)
    messages.push(`Cliente → ${target.ip} OK`)
    return { ok: true, messages }
  } catch (e) {
    messages.push(e instanceof Error ? e.message : String(e))
    return { ok: false, messages }
  }
}

/** Áreas configuradas (para diagnóstico/estado en la UI). */
export function configuredAreas(): string[] {
  return PRINT_AREAS.filter((area) => getAreaPrinter(area) != null).map((a) => normalizePrinterArea(a))
}
