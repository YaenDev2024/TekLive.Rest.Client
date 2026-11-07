/**
 * TekLive Rest · Ticket service (Fase 3c) — tipos del documento de ticket.
 *
 * Modelo intermedio neutral (ni ESC/POS ni HTML): los builders réplica del
 * printing_service.dart de CrazyWings producen un TicketDoc y los renderers
 * lo convierten (HTML para browser hoy, bytes ESC/POS para Tauri después).
 *
 * Ancho 48 chars = PaperSize.mm80 del Flutter (línea Generator mm80 ≈ 48
 * columnas fuente A); los builders centran/recortan contra este ancho.
 */

/** Documento completo: ancho en columnas + líneas ordenadas. */
export interface TicketDoc {
  width: number
  lines: TicketLine[]
}

/** Ruta del logo del ticket cliente (réplica assets/logo3.png del Flutter). */
export const TICKET_LOGO_URL = new URL('./ticket-logo.png', import.meta.url).href

/**
 * Línea de ticket:
 * - text: libre (centrado para headers, izquierda para datos) con flags
 *   bold / double (doble ancho-alto ESC/POS ⇒ fuente mayor en HTML).
 * - row: dos columnas justificadas (left ... right) — items, resúmenes.
 *   bold/double aplican a AMBAS columnas; leftBold/leftDouble/rightBold/
 *   rightDouble permiten estilos por columna (réplica PosColumn con
 *   PosStyles independientes del Flutter).
 * - hr: línea separadora '-' repetida al ancho.
 * - feed: n líneas en blanco.
 * - cut: corte de papel (GS V en ESC/POS; en HTML solo un espacio final).
 * - logo: imagen centrada (ticket cliente, réplica generator.image L944).
 */
export type TicketLine =
  | { kind: 'text'; text: string; align: 'left' | 'center' | 'right'; bold?: boolean; double?: boolean }
  | {
      kind: 'row'
      left: string
      right: string
      bold?: boolean
      double?: boolean
      leftBold?: boolean
      leftDouble?: boolean
      rightBold?: boolean
      rightDouble?: boolean
    }
  | { kind: 'hr' }
  | { kind: 'feed'; n: number }
  | { kind: 'cut' }
  | { kind: 'logo' }

/** Ancho estándar 80mm (réplica PaperSize.mm80 de printing_service.dart). */
export const TICKET_WIDTH_80MM = 48
