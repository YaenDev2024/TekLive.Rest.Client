/**
 * TekLive Rest · Ticket cocina — réplica EXACTA de _buildEscPosKitchenTicket
 * (printing_service.dart L719-922 de CrazyWings).
 *
 * Flujo del original:
 *   'ORDEN PARA PREPARAR' centrado → 'Listo para: HH:mm' (+20 min) → hr
 *   → row 'ORDEN  #N' (8 cols, doble) + 'HORA  HH:mm' (4, derecha) → hr
 *   → bloque por tipo: LOCAL folio grande / EXTERNO cliente+TEL grandes /
 *     DIDI-UBER 'TIPO-' + deliveryInfo → hr
 *   → 'Atendio: X' + 'Fecha: dd/MM/yyyy' → hr
 *   → 'PRODUCTOS A PREPARAR' centrado + feed
 *   → items '2x NOMBRE' doble-bold con notas '  • x' (opciones divididas
 *     por coma; NOTA:: con 2 espacios) + Extras: '  • x' + Complementos:
 *     '  • x' (L864-888: SIEMPRE se muestran en cocina) + feed + hr por item
 *   → hr + 'TOTAL: $X' centrado doble → hr
 *   → 'Tiempo: 20 min' + 'Impreso: HH:mm' → feed 3 + cut + feed 1.
 */

import { TICKET_WIDTH_80MM, type TicketDoc, type TicketLine } from './types'

/** Item de entrada para cocina (desde el carrito o el detalle backend). */
export interface KitchenTicketItem {
  quantity: number
  productName: string
  /**
   * Nota COMBINADA tal como viaja al backend (OPT::... || NOTE::...): el
   * parser de abajo la descompone igual que _appendEscPosParsedNotes.
   */
  notes?: string | null
  /**
   * Nombres de extras YA limpios (_displayModifierName) — en cocina se
   * muestran SIEMPRE como 'Extras:' + '  • x' (L864-875), incluso con nota.
   */
  extras?: string[]
  /** Nombres de complementos limpios — 'Complementos:' (L877-888). */
  complements?: string[]
}

/**
 * Réplica _displayModifierName (L1326-1328): '_' y '-' → espacio, trim.
 * Aplica a nombres de extras/complementos en AMBOS tickets.
 */
export function displayModifierName(name: string): string {
  return name.replaceAll(/[_-]/g, ' ').trim()
}

export interface KitchenTicketInput {
  /** Folio mostrado: dailyOrderNumber ?? folio ?? orderId (L748-750). */
  folio: string
  orderType: string
  /** Nombre del cajero/atendió ('' lo omite como el original). */
  cashierName?: string | null
  /** Cliente serializado o info de plataforma (EXTERNO/UBER/DIDI). */
  customerName?: string | null
  /** Teléfono del cliente EXTERNO (grande si existe, L783-789). */
  customerPhone?: string | null
  /** Info de repartidor para DIDI/UBER (L801-807). */
  platformDeliveryInfo?: string | null
  items: KitchenTicketItem[]
  total: number
  /** Hora de creación de la orden (default ahora). */
  createdAt?: Date
  /** Momento de impresión (default ahora). */
  printedAt?: Date
  /**
   * Ronda Piso 1 — flags del backend (ticket_service.dart L18-26
   * generateKitchenTicketPdf): showModifiers = showKitchenModifiers filtra
   * Extras/Complementos (L451-474 del PDF, aquí L864-888 ESC/POS);
   * showNotes = showKitchenNotes filtra las notas parseadas (L476-477).
   * Default true/true = comportamiento histórico (cocina SIEMPRE mostraba).
   */
  showModifiers?: boolean
  showNotes?: boolean
}

// ---------------------------------------------------------------------------
// Parser de notas — réplica _parseNoteTokens + _appendEscPosParsedNotes
// (printing_service.dart L1352-1479): opciones '  • x' (split por coma),
// notas '  x' (2 espacios). Hereda la heurística de continuación.
// ---------------------------------------------------------------------------

type NoteToken = { kind: 'option' | 'note'; text: string }

function looksLikeOptionContinuation(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.startsWith('mitad ') ||
    lower.startsWith('medio ') ||
    lower.startsWith('con ') ||
    lower.startsWith('sin ') ||
    lower.includes('boneless') ||
    lower.includes('breaded') ||
    lower.includes('pechuga') ||
    lower.includes('muslo')
  )
}

function splitEmbeddedTags(input: string): string[] {
  const tags = ['OPT::', 'NOTA::', 'NOTE::']
  const result: string[] = []
  let remaining = input
  while (true) {
    let bestIdx: number | null = null
    for (const tag of tags) {
      const idx = remaining.indexOf(tag)
      if (idx <= 0) continue // solo tags embebidos (no al inicio)
      if (bestIdx == null || idx < bestIdx) bestIdx = idx
    }
    if (bestIdx == null) {
      result.push(remaining)
      break
    }
    const before = remaining.substring(0, bestIdx).trim()
    remaining = remaining.substring(bestIdx).trim()
    if (before !== '') result.push(before)
  }
  return result
}

function cleanOptionText(value: string): string {
  let text = value.trim()
  while (text.startsWith('OPT::')) text = text.substring('OPT::'.length).trim()
  text = text.replaceAll('NOTA::', '').replaceAll('NOTE::', '').trim()
  if (text.toUpperCase().startsWith('OPT:')) text = text.substring('OPT:'.length).trim()
  return text
}

function cleanNoteText(value: string): string {
  let text = value.trim()
  while (text.startsWith('NOTA::') || text.startsWith('NOTE::')) {
    text = text.startsWith('NOTE::')
      ? text.substring('NOTE::'.length).trim()
      : text.substring('NOTA::'.length).trim()
  }
  if (text.toUpperCase().startsWith('NOTA:')) text = text.substring('NOTA:'.length).trim()
  if (text.toUpperCase().startsWith('NOTE:')) text = text.substring('NOTE:'.length).trim()
  return text.replaceAll('OPT::', '').replaceAll('NOTE::', '').replaceAll('NOTA::', '').trim()
}

function cleanPlainText(value: string): string {
  let text = value
    .trim()
    .replaceAll('OPT::', '')
    .replaceAll('NOTE::', '')
    .replaceAll('NOTA::', '')
    .trim()
  if (text.toUpperCase().startsWith('NOTA:')) text = text.substring('NOTA:'.length).trim()
  if (text.toUpperCase().startsWith('NOTE:')) text = text.substring('NOTE:'.length).trim()
  return text
}

/** Réplica fiel de _parseNoteTokens (L1403-1479). */
export function parseNoteTokens(noteRaw: string): NoteToken[] {
  const raw = noteRaw.trim()
  if (raw === '') return []

  const hasOptionTags = raw.includes('OPT::')
  const hasNoteTags = raw.includes('NOTE::') || raw.includes('NOTA::')

  const segments: string[] = []
  for (const line of raw.split(/[\r\n]+/)) {
    for (const part of line.split('|')) {
      const trimmed = part.trim()
      if (trimmed === '') continue
      segments.push(...splitEmbeddedTags(trimmed))
    }
  }

  const tokens: NoteToken[] = []
  let lastWasOption = false

  for (const seg of segments) {
    const trimmed = seg.trim()
    if (trimmed === '') continue

    if (trimmed.startsWith('OPT::')) {
      const text = cleanOptionText(trimmed)
      if (text !== '') {
        tokens.push({ kind: 'option', text })
        lastWasOption = true
      }
      continue
    }
    if (trimmed.startsWith('NOTA::') || trimmed.startsWith('NOTE::')) {
      const text = cleanNoteText(trimmed)
      if (text !== '') {
        tokens.push({ kind: 'note', text })
        lastWasOption = false
      }
      continue
    }
    // Dentro de un bloque OPT:: el segmento sin prefijo es opción (L1451-1454).
    if (lastWasOption) {
      tokens.push({ kind: 'option', text: trimmed })
      continue
    }
    if (looksLikeOptionContinuation(trimmed)) {
      tokens.push({ kind: 'option', text: trimmed })
      lastWasOption = true
      continue
    }
    // Fallback legacy SOLO si no hay tags OPT:: (L1464-1475).
    if (!hasOptionTags || hasNoteTags) {
      const text = cleanPlainText(trimmed)
      if (text !== '') {
        tokens.push({ kind: 'note', text })
        lastWasOption = false
      }
    }
  }
  return tokens
}

/** Réplica _appendEscPosParsedNotes (L1352-1401): textos con prefijo listo. */
function noteLinesOf(noteRaw: string | null | undefined): string[] {
  if (noteRaw == null || noteRaw.trim() === '') return []
  const lines: string[] = []
  for (const token of parseNoteTokens(noteRaw)) {
    if (token.text === '') continue
    if (token.kind === 'option') {
      // Opciones con coma → múltiples líneas (L1366-1379).
      if (token.text.includes(',')) {
        for (const part of token.text.split(',')) {
          const trimmed = part.trim()
          if (trimmed !== '') lines.push(`  • ${trimmed}`)
        }
      } else {
        lines.push(`  • ${token.text}`)
      }
    } else {
      lines.push(`  ${token.text}`) // notas: 2 espacios (L1390-1398)
    }
  }
  return lines
}

// ---------------------------------------------------------------------------
// Helpers de fecha (formato EXACTO del Flutter)
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatHhMm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDdMmYyyy(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Construye el TicketDoc de COCINA. Textos/estructura = _buildEscPosKitchenTicket.
 */
export function buildKitchenTicket(input: KitchenTicketInput): TicketDoc {
  const lines: TicketLine[] = []
  const now = input.printedAt ?? new Date()
  const createdAt = input.createdAt ?? now
  const tipoOrden = (input.orderType ?? 'LOCAL').toUpperCase()
  // Ronda Piso 1: flags del ticket-config (default true = histórico).
  const showModifiers = input.showModifiers ?? true
  const showNotes = input.showNotes ?? true

  // ===== ENCABEZADO (L728-745) =====
  lines.push({ kind: 'text', text: 'ORDEN PARA PREPARAR', align: 'center' })
  const preparationTime = formatHhMm(new Date(now.getTime() + 20 * 60_000))
  lines.push({ kind: 'text', text: `Listo para: ${preparationTime}`, align: 'center' })
  lines.push({ kind: 'hr' })

  // ===== INFO CARD: FOLIO + HORA (L747-762) =====
  // Row 8/4 del Flutter: folio bold DOBLE (columna 8), HORA derecha normal.
  lines.push({
    kind: 'row',
    left: `ORDEN  #${input.folio}`,
    right: `HORA  ${formatHhMm(createdAt)}`,
    leftBold: true,
    leftDouble: true,
  })
  lines.push({ kind: 'hr' })

  // ===== BLOQUE POR TIPO (L764-818) =====
  if (tipoOrden === 'LOCAL') {
    lines.push({ kind: 'text', text: `ORDEN #${input.folio}`, align: 'center', bold: true, double: true })
  } else if (tipoOrden === 'EXTERNO') {
    lines.push({ kind: 'text', text: input.customerName ?? 'CLIENTE EXTERNO', align: 'center', bold: true, double: true })
    if (input.customerPhone != null && input.customerPhone !== '') {
      lines.push({ kind: 'text', text: `TEL: ${input.customerPhone}`, align: 'center', bold: true, double: true })
    }
  } else if (tipoOrden.includes('DIDI') || tipoOrden.includes('UBER') || tipoOrden === 'PLATAFORMA') {
    lines.push({ kind: 'text', text: `${tipoOrden}-`, align: 'center', bold: true, double: true })
    const deliveryInfo = input.platformDeliveryInfo?.trim() !== '' && input.platformDeliveryInfo != null
      ? input.platformDeliveryInfo
      : (input.customerName ?? 'UBER/DIDI')
    lines.push({ kind: 'text', text: deliveryInfo, align: 'center', bold: true })
  } else {
    lines.push({ kind: 'text', text: input.customerName ?? '', align: 'center', bold: true, double: true })
  }

  // ===== ATENDIO / FECHA (L820-830) =====
  lines.push({ kind: 'hr' })
  lines.push({ kind: 'text', text: `Atendio: ${input.cashierName ?? 'CAJERO'}`, align: 'left' })
  lines.push({ kind: 'text', text: `Fecha: ${formatDdMmYyyy(createdAt)}`, align: 'left' })
  lines.push({ kind: 'hr' })

  // ===== PRODUCTOS (L832-892) =====
  lines.push({ kind: 'text', text: 'PRODUCTOS A PREPARAR', align: 'center' })
  lines.push({ kind: 'feed', n: 1 })

  for (const item of input.items) {
    lines.push({ kind: 'feed', n: 1 })
    lines.push({ kind: 'text', text: `${item.quantity}x ${item.productName}`, align: 'left', bold: true, double: true })
    // Notas parseadas (L857-860) — filtradas por showKitchenNotes (L476-477).
    if (showNotes) {
      for (const noteLine of noteLinesOf(item.notes)) {
        lines.push({ kind: 'text', text: noteLine, align: 'left' })
      }
    }
    // Extras: en cocina SIEMPRE se mostraban (L864-875); showKitchenModifiers
    // filtra (réplica L451-461 del PDF: `if (showModifiers && extras…)`).
    if (showModifiers && item.extras != null && item.extras.length > 0) {
      lines.push({ kind: 'text', text: 'Extras:', align: 'left' })
      for (const extra of item.extras) {
        lines.push({ kind: 'text', text: `  • ${displayModifierName(extra)}`, align: 'left' })
      }
    }
    // Complementos (L877-888) — mismo flag showKitchenModifiers (L464-474).
    if (showModifiers && item.complements != null && item.complements.length > 0) {
      lines.push({ kind: 'text', text: 'Complementos:', align: 'left' })
      for (const comp of item.complements) {
        lines.push({ kind: 'text', text: `  • ${displayModifierName(comp)}`, align: 'left' })
      }
    }
    lines.push({ kind: 'feed', n: 1 })
    lines.push({ kind: 'hr' })
  }

  // ===== TOTAL (L894-905) =====
  lines.push({ kind: 'hr' })
  lines.push({ kind: 'text', text: `TOTAL: $${input.total.toFixed(2)}`, align: 'center', bold: true, double: true })
  lines.push({ kind: 'hr' })

  // ===== FOOTER (L907-919) =====
  lines.push({ kind: 'hr' })
  lines.push({ kind: 'text', text: 'Tiempo: 20 min', align: 'center' })
  lines.push({ kind: 'text', text: `Impreso: ${formatHhMm(now)}`, align: 'center' })
  lines.push({ kind: 'feed', n: 3 })
  lines.push({ kind: 'cut' })
  lines.push({ kind: 'feed', n: 1 })

  return { width: TICKET_WIDTH_80MM, lines }
}

/** Re-export para el builder del cliente (mismo parser de notas). */
export { noteLinesOf as buildNoteLines }
