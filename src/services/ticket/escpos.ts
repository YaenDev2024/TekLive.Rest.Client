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
import { TICKET_LOGO_URL } from './types'

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

// ---------------------------------------------------------------------------
// Logo: PNG -> raster monocromo 1-bit -> GS v 0 (ronda logo térmica).
//
// El Flutter mandaba el PNG con el paquete printing (generator.image), que
// internamente rasteriza a 1-bit y emite `GS v 0` (BitImage). Aquí se replica
// ese byte-stream sin dependencias: decodificador PNG propio (unfilter +
// inflate via DecompressionStream nativo, disponible en WebView2/Tauri y
// Chrome 80+) y raster con umbral de luminancia.
//
// El centrado se hace con ESC a 1 (alineación nativa de la térmica) y el
// bitmap va a su ancho real: NO se rellena al ancho completo de impresión
// porque los modelos de 80mm varían (576 vs 512 dots) y el padding fijo
// recortaría el logo en los de 512.
// ---------------------------------------------------------------------------

/** Ancho objetivo del logo en puntos (384 dots = 48mm a 8 dots/mm). */
const LOGO_TARGET_DOTS = 384
/** Umbral de luminancia para el 1-bit (0-255; menor = más negro conservado). */
const LUMA_THRESHOLD = 140

/** Cabecera GS v 0 (modo 0): bytes por fila + alto por fila = 1. */
function gsV0Header(widthBytes: number, heightRows: number): number[] {
  return [GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, heightRows & 0xff, (heightRows >> 8) & 0xff]
}

/**
 * PNG decodificado crudo: píxeles RGBA (colorType 6) o RGB (2), 8-bit.
 * Solo se soporta el formato del logo del ticket (truecolor sin paleta ni
 * entrelazado); cualquier otro formato -> null y el ticket sale sin logo
 * (el mismo fail-safe que tenía el placeholder).
 */
interface RawPng {
  width: number
  height: number
  rgba: Uint8Array
}

/** Inflate de un zlib stream via DecompressionStream('deflate') nativo. */
async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** Decodifica un PNG truecolor (colorType 2 o 6, bitDepth 8, sin entrelazar). */
async function decodePngRgba(bytes: Uint8Array): Promise<RawPng | null> {
  // Firma PNG + verificación mínima de chunks.
  const u32 = (o: number): number => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  if (u32(0) !== 0x89504e47) return null
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  const idat: Uint8Array[] = []
  const palette: number[][] = []
  let trns: number[] = []
  while (pos + 8 <= bytes.length) {
    const len = u32(pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const data = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = u32(pos + 8)
      height = u32(pos + 12)
      bitDepth = bytes[pos + 16]
      colorType = bytes[pos + 17]
      interlace = bytes[pos + 20]
    } else if (type === 'PLTE') {
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]])
    } else if (type === 'tRNS') {
      trns = [...data]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (width === 0 || height === 0) return null
  if (interlace !== 0) return null
  // El logo del ticket es RGBA 8-bit; se acepta también RGB y paleta por si
  // la imagen se optimiza en el build (pngquant lo convierte a paleta).
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 0 ? 1 : -1
  if (channels < 0 || bitDepth !== 8) return null

  let raw: Uint8Array
  try {
    const total = new Uint8Array(idat.reduce((a, b) => a + b.length, 0))
    let off = 0
    for (const chunk of idat) {
      total.set(chunk, off)
      off += chunk.length
    }
    raw = await inflateZlib(total)
  } catch {
    return null
  }

  // Unfilter (filtros por fila del PNG estándar).
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) return null
  const pixels = new Uint8Array(width * height * 4)
  const rowPrev = new Uint8Array(stride)
  const rowCur = new Uint8Array(stride)
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x]
      const a = x >= channels ? rowCur[x - channels] : 0
      const b = rowPrev[x]
      const c = x >= channels ? rowPrev[x - channels] : 0
      let v = rawByte
      switch (filter) {
        case 1:
          v = rawByte + a
          break
        case 2:
          v = rawByte + b
          break
        case 3:
          v = rawByte + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
      }
      rowCur[x] = v & 0xff
    }
    rowPrev.set(rowCur)
    src += stride
    // Copiar a RGBA (8-bit por canal).
    const dstRow = y * width * 4
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = dstRow + x * 4
      if (channels === 1 && colorType === 3) {
        const idx = rowCur[s]
        const pal = palette[idx] ?? [0, 0, 0]
        pixels[d] = pal[0]
        pixels[d + 1] = pal[1]
        pixels[d + 2] = pal[2]
        pixels[d + 3] = trns[idx] ?? 255
      } else if (channels === 1) {
        pixels[d] = rowCur[s]
        pixels[d + 1] = rowCur[s]
        pixels[d + 2] = rowCur[s]
        pixels[d + 3] = 255
      } else {
        pixels[d] = rowCur[s]
        pixels[d + 1] = rowCur[s + 1]
        pixels[d + 2] = rowCur[s + 2]
        pixels[d + 3] = channels === 4 ? rowCur[s + 3] : 255
      }
    }
  }
  return { width, height, rgba: pixels }
}

/** Bitmap 1-bit filas-MSB con padding a byte (formato GS v 0). */
function rgbaToMono(png: RawPng): { widthDots: number; widthBytes: number; heightRows: number; bits: Uint8Array } {
  // Escala proporcional al ancho objetivo (nearest-neighbor: en térmica el
  // aliasing es irrelevante y preserva el detalle de líneas finas).
  const scale = LOGO_TARGET_DOTS / png.width
  const widthDots = Math.round(png.width * scale)
  const heightRows = Math.max(1, Math.round(png.height * scale))
  const widthBytes = Math.ceil(widthDots / 8)
  const bits = new Uint8Array(widthBytes * heightRows)
  for (let dy = 0; dy < heightRows; dy++) {
    const sy = Math.min(png.height - 1, Math.floor(dy / scale))
    for (let dx = 0; dx < widthDots; dx++) {
      const sx = Math.min(png.width - 1, Math.floor(dx / scale))
      const o = (sy * png.width + sx) * 4
      const a = png.rgba[o + 3]
      // alpha 0 = papel (sin quemar punto); el resto: luminancia ITU-R 601.
      if (a > 32) {
        const luma = 0.299 * png.rgba[o] + 0.587 * png.rgba[o + 1] + 0.114 * png.rgba[o + 2]
        if (luma < LUMA_THRESHOLD) {
          const byteIdx = dy * widthBytes + (dx >> 3)
          bits[byteIdx] |= 0x80 >> (dx & 7)
        }
      }
    }
  }
  return { widthDots, widthBytes, heightRows, bits }
}

/** Cache del byte-stream del logo (el PNG no cambia en runtime). */
let logoCache: number[] | null = null
let logoFailed = false

async function loadLogoBytes(): Promise<number[]> {
  if (logoFailed) return []
  if (logoCache != null) return logoCache
  try {
    const res = await fetch(TICKET_LOGO_URL)
    if (!res.ok) throw new Error(`logo HTTP ${res.status}`)
    const png = new Uint8Array(await res.arrayBuffer())
    const decoded = await decodePngRgba(png)
    if (decoded == null) throw new Error('formato de logo no soportado')
    const mono = rgbaToMono(decoded)
    // GS v 0 con el ancho REAL del logo (sin padding al ancho de impresión:
    // los modelos de 80mm varían 512/576 dots y el relleno fijo recortaría).
    // El centrado lo hace la térmica con ESC a 1 que envuelve el bitmap.
    const bytes: number[] = [
      ...setAlign('center'),
      ...gsV0Header(mono.widthBytes, mono.heightRows),
      ...mono.bits,
      ...setAlign('left'),
    ]
    logoCache = bytes
    return bytes
  } catch {
    // Fail-safe permanente en esta sesión: ticket sin logo (como antes).
    logoFailed = true
    return []
  }
}

/** Versión síncrona usada por el renderer: cache o vacío (no bloquea). */
function logoEscPosBytes(): number[] {
  if (logoCache != null) return logoCache
  if (logoFailed) return []
  // Primera impresión sin logo; el preload async llena el cache para la siguiente.
  void loadLogoBytes()
  return []
}

/** Precarga del logo (llamar al montar la app: la 1a impresión ya sale con él). */
export function preloadTicketLogo(): void {
  void loadLogoBytes()
}/** Codifica texto Latin-1 (la térmica no es UTF-8; acentos básicos OK). */
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
    case 'logo': {
      // R\u00e9plica generator.image(logo3.png) del Flutter (L944): raster
      // monocromo 1-bit del PNG via GS v 0 (el est\u00e1ndar ESC/POS que toda
      // t\u00e9rmica 80mm decodifica). El PNG se decodifica una sola vez y se
      // cachea (los tickets se imprimen repetidos en jornada).
      const bytes = logoEscPosBytes()
      return bytes.length > 0 ? [...bytes, 0x0a] : [0x0a]
    }
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
