/**
 * TekLive Rest · Ticket service (Fase 3c) — barrel de imports.
 *
 * Flujo: builder (layout-*.ts) → TicketDoc → renderTicketHtml/printTicket
 * (browser hoy) o ticketToEscPosBytes (Tauri después).
 */
export * from './types'
export * from './layout-kitchen'
export * from './layout-client'
export * from './render-html'
export * from './escpos'
