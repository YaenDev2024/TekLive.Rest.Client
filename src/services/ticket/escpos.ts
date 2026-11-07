/**
 * TekLive Rest · ESC/POS encoder del TicketDoc (Fase 3c — para Tauri).
 *
 * Hoy NO se usa en producción (la impresión va por el diálogo del navegador);
 * existe para el futuro canal Tauri (socket 9100) y para pruebas manuales del
 * byte-stream. Réplica de los comandos del printing_service.dart:
 *   ESC @ (init) · ESC a n (align) · GS ! n (double) · ESC ! n (bold) ·
 *   hr '-' · GS V 66 0 (cut parcial).
 */

import type { TicketDoc, TicketLine } from './types'

// --- Comandos ESC/POS -------------------------------------------------------

const ESC = 0x1b
const GS = 0x1d

/** ESC @ — inicializa la impresora (printing_service usa fuente A via ESC M 0). */
function init(): number[] {
  return [ESC, 0x40, ESC, 0x4d, 0x00]
}

/** ESC a n — alineación (0 izquierda, 1 centro, 2 derecha). */
function setAlign(align: 'left' | 'center' | 'right'): number[] {
  return [ESC, 0x61, align === 'center' ? 0x01 : align === 'right' ? 0x02 : 0x00]
}

/** GS ! n — tamaño (0x11 = doble ancho+alto; réplica size2 del Flutter). */
function setSize(double: boolean): number[] {
  return [GS, 0x21, double ? 0x11 : 0x00]
}

/** ESC ! n — print mode (bit 3 = bold; réplica bold del Generator). */
function setBold(bold: boolean): number[] {
  return [ESC, 0x21, bold ? 0x08 : 0x00]
}

/** GS V 66 0 — corte parcial (generator.cut() del Flutter). */
function cut(): number[] {
  return [GS, 0x56, 0x42, 0x00]
}

/** Codifica texto Latin-1 (la térmica no es UTF-8; acentos básicos OK). */
function text(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x20
    bytes.push(code <= 0xff ? code : 0x3f) // '?' si no es representable
  }
  bytes.push(0x0a) // LF
  return bytes
}

function padCenter(text: string, width: number): string {
  const t = text.length > width ? text.substring(0, width) : text
  const pad = Math.max(0, Math.floor((width - t.length) / 2))
  return ' '.repeat(pad) + t
}

/** Relleno a la izquierda para align right (el ESC/POS ya posiciona, esto
 *  normaliza el texto como hace el HTML). */
function padRight(text: string, width: number, right: boolean): string {
  const t = text.length > width ? text.substring(0, width) : text
  return right ? ' '.repeat(Math.max(0, width - t.length)) + t : t
}

function renderLine(line: TicketLine, width: number): number[] {
  switch (line.kind) {
    case 'text': {
      const content =
        line.align === 'center' ? padCenter(line.text, width) : padRight(line.text, width, line.align === 'right')
      return [
        ...setAlign(line.align),
        ...setBold(line.bold ?? false),
        ...setSize(line.double ?? false),
        ...text(content),
        ...setSize(false),
        ...setBold(false),
        ...setAlign('left'),
      ]
    }
    case 'row': {
      let right = line.right
      const space = width - line.left.length - right.length
      if (space < 1) right = right.substring(0, Math.max(0, width - line.left.length - 1))
      const leftDouble = line.leftDouble ?? line.double ?? false
      const rightDouble = line.rightDouble ?? line.double ?? false
      // Réplica PosColumn con estilos independientes por columna: el texto
      // derecho alinea a la derecha dentro de su bloque (como el Flutter).
      return [
        ...setAlign('left'),
        ...setBold(line.leftBold ?? line.bold ?? false),
        ...setSize(leftDouble),
        ...text(line.left),
        ...setSize(false),
        ...setBold(false),
        ...setAlign('right'),
        ...setBold(line.rightBold ?? line.bold ?? false),
        ...setSize(rightDouble),
        ...text(right),
        ...setSize(false),
        ...setBold(false),
      ]
    }
    case 'hr':
      return text('-'.repeat(width))
    case 'feed':
      return new Array(Math.max(0, line.n)).fill(0x0a)
    case 'cut':
      return cut()
    case 'logo':
      // En Tauri: decodificar PNG y enviar GS v 0 (bitimage) como el Flutter
      // (generator.image L944). Placeholder: feed para mantener altura.
      return [0x0a]
    default:
      return []
  }
}

/**
 * Construye el byte-stream ESC/POS del documento (export buildEscPos).
 * Uso futuro: Tauri `socket.write(ip:9100, bytes)` como el Flutter.
 */
export function ticketToEscPosBytes(doc: TicketDoc): Uint8Array {
  const bytes: number[] = [...init()]
  for (const line of doc.lines) {
    bytes.push(...renderLine(line, doc.width))
  }
  bytes.push(0x0a) // feed final tras el cut (réplica L919/1239)
  return new Uint8Array(bytes)
}

/** Alias pedido por el plan (futuro Tauri; hoy solo pruebas manuales). */
export const buildEscPos = ticketToEscPosBytes
