/**
 * TekLive Rest · Persistencia de impresoras (ronda Piso 1) — réplica de las
 * SharedPreferences del Flutter (printer_settings_screen.dart +
 * printing_service.dart L17-27 + KitchenPrinterProvider) con LAS MISMAS KEYS
 * para que un dispositivo migre sin reconfigurar.
 *
 * Formato de keywords: stringList 'product_keywords' con entradas
 * 'KEYWORD:AREA:sortOrder' (product_keyword_provider.dart L55-59). Área
 * normalizada: CORTES → COCINA (compat legacy L155-157).
 */

const KEY_MAIN_IP = 'selected_printer_ip'
const KEY_MAIN_NAME = 'selected_printer_name'
const KEY_MAIN_IS_USB = 'selected_printer_is_usb'
const KEY_MAIN_USB_NAME = 'usb_printer_name'

const KEY_K1_IP = 'kitchen_printer_1_ip'
const KEY_K1_NAME = 'kitchen_printer_1_name'
const KEY_K1_IS_USB = 'kitchen_printer_1_is_usb'
const KEY_K2_IP = 'kitchen_printer_2_ip'
const KEY_K2_NAME = 'kitchen_printer_2_name'
const KEY_K2_IS_USB = 'kitchen_printer_2_is_usb'

const KEY_KEYWORDS = 'product_keywords'

/** Áreas réplica _printAreas (L102) — el orden es el de la UI. */
export const PRINT_AREAS = ['HAMBURGUESAS', 'COCINA', 'CLIENTE'] as const
export type PrintArea = (typeof PRINT_AREAS)[number]

/** Configuración de una impresora por área (kitchen_printer_model.dart). */
export interface AreaPrinter {
  /** IP de red, o nombre de impresora USB/Windows si isUsb. */
  ip: string
  isUsb: boolean
  port: number
  /** Nombre real de la impresora Windows (solo USB). */
  usbName?: string
}

/** Entrada de palabra clave (product_keyword_model.dart). */
export interface ProductKeyword {
  id: number
  keyword: string
  printerArea: PrintArea
  sortOrder: number
}

function str(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key)
    return v != null && v !== '' ? v : null
  } catch {
    return null
  }
}

function setStr(key: string, value: string | null): void {
  try {
    if (value == null || value === '') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* localStorage lleno/bloqueado: la app sigue sin persistir */
  }
}

function bool(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function setBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    /* idem */
  }
}

/** Réplica _normalizePrinterArea (printing_service L852-855). */
export function normalizePrinterArea(area: string): PrintArea {
  const normalized = area.trim().toUpperCase()
  return (normalized === 'CORTES' ? 'COCINA' : normalized) as PrintArea
}

// ---------------------------------------------------------------------------
// Impresora principal (cliente / caja)
// ---------------------------------------------------------------------------

/** Impresora principal guardada: { ip, name, isUsb } o null. */
export function getMainPrinter(): { ip: string; name: string; isUsb: boolean } | null {
  const ip = str(KEY_MAIN_IP)
  if (ip == null) return null
  return { ip, name: str(KEY_MAIN_NAME) ?? '', isUsb: bool(KEY_MAIN_IS_USB) }
}

/** Guarda la principal (réplica _savePrinter L396-413: ip + name + isUsb). */
export function setMainPrinter(ip: string, name: string, isUsb: boolean, usbName?: string): void {
  setStr(KEY_MAIN_IP, ip)
  setStr(KEY_MAIN_NAME, name)
  setBool(KEY_MAIN_IS_USB, isUsb)
  // usb_printer_name es el nombre que resuelve _isUsbPrinterOnline (L86-87).
  if (isUsb) setStr(KEY_MAIN_USB_NAME, usbName ?? name)
  else setStr(KEY_MAIN_USB_NAME, null)
}

// ---------------------------------------------------------------------------
// Cocinas 1/2 (doble impresión)
// ---------------------------------------------------------------------------

export interface KitchenSlot {
  ip: string
  name: string
  isUsb: boolean
}

export function getKitchenSlot(slot: 1 | 2): KitchenSlot | null {
  const ip = str(slot === 1 ? KEY_K1_IP : KEY_K2_IP)
  if (ip == null) return null
  return {
    ip,
    name: str(slot === 1 ? KEY_K1_NAME : KEY_K2_NAME) ?? '',
    isUsb: bool(slot === 1 ? KEY_K1_IS_USB : KEY_K2_IS_USB),
  }
}

/** Réplica _saveKitchenPrinter (L302-329): ip + name + isUsb por slot. */
export function setKitchenSlot(slot: 1 | 2, ip: string, name: string, isUsb: boolean): void {
  if (slot === 1) {
    setStr(KEY_K1_IP, ip)
    setStr(KEY_K1_NAME, name)
    setBool(KEY_K1_IS_USB, isUsb)
  } else {
    setStr(KEY_K2_IP, ip)
    setStr(KEY_K2_NAME, name)
    setBool(KEY_K2_IS_USB, isUsb)
  }
}

// ---------------------------------------------------------------------------
// Impresoras por área
// ---------------------------------------------------------------------------

/**
 * Lee la impresora de un área. Réplica _getPrinterForArea (L182-219): areasToCheck
 * COCINA → ['COCINA', 'CORTES'] (compat legacy), usb_name/name como respaldos
 * del valor de kitchen_<AREA>_ip.
 */
export function getAreaPrinter(area: PrintArea | string): AreaPrinter | null {
  const normalized = normalizePrinterArea(area)
  const areasToCheck: string[] = normalized === 'COCINA' ? ['COCINA', 'CORTES'] : [normalized]
  for (const candidate of areasToCheck) {
    const value = str(`kitchen_${candidate}_ip`)
    if (value == null) continue
    const isUsb = bool(`kitchen_${candidate}_is_usb`)
    if (isUsb) {
      const usbName =
        str(`kitchen_${candidate}_usb_name`) ?? str(`kitchen_${candidate}_name`) ?? value
      if (usbName.trim() === '') return null
      return { ip: value, isUsb: true, port: 9100, usbName: usbName.trim() }
    }
    return { ip: value.trim(), isUsb: false, port: 9100 }
  }
  return null
}

/**
 * Guarda la impresora de un área (réplica _persistAreaPrinter L191-218 →
 * KitchenPrinterProvider.addPrinter: el nombre USB VIVE en kitchen_<AREA>_ip).
 */
export function setAreaPrinter(area: PrintArea | string, printer: AreaPrinter): void {
  const normalized = normalizePrinterArea(area)
  setStr(`kitchen_${normalized}_ip`, printer.ip)
  setBool(`kitchen_${normalized}_is_usb`, printer.isUsb)
  if (printer.isUsb && printer.usbName != null && printer.usbName !== '') {
    setStr(`kitchen_${normalized}_usb_name`, printer.usbName)
  }
}

/** Quita la impresora de un área (réplica deletePrinterByArea). */
export function clearAreaPrinter(area: PrintArea | string): void {
  const normalized = normalizePrinterArea(area)
  setStr(`kitchen_${normalized}_ip`, null)
  setStr(`kitchen_${normalized}_is_usb`, null)
  setStr(`kitchen_${normalized}_usb_name`, null)
  setStr(`kitchen_${normalized}_name`, null)
}

// ---------------------------------------------------------------------------
// Palabras clave (product_keywords)
// ---------------------------------------------------------------------------

/**
 * Carga las keywords réplica loadKeywords (L17-48): split ':' → [keyword, area,
 * sortOrder]. Normaliza área (CORTES→COCINA). Orden estable por sortOrder.
 */
export function loadKeywords(): ProductKeyword[] {
  let raw: string[] = []
  try {
    const stored = window.localStorage.getItem(KEY_KEYWORDS)
    if (stored != null) {
      const parsed: unknown = JSON.parse(stored)
      if (Array.isArray(parsed)) raw = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    raw = []
  }
  const keywords: ProductKeyword[] = []
  let nextId = 1
  for (const entry of raw) {
    const parts = entry.split(':')
    if (parts.length >= 2 && parts[0].trim() !== '') {
      keywords.push({
        id: nextId++,
        keyword: parts[0].trim(),
        printerArea: normalizePrinterArea(parts[1]),
        sortOrder: parts.length >= 3 ? Number.parseInt(parts[2], 10) || 0 : 0,
      })
    }
  }
  return keywords
}

/** Serializa réplica saveKeywords (L50-67): 'KW:AREA:sortOrder'. */
function saveKeywords(keywords: ProductKeyword[]): void {
  const formatted = keywords.map(
    (kw) => `${kw.keyword}:${normalizePrinterArea(kw.printerArea)}:${kw.sortOrder ?? 0}`,
  )
  try {
    window.localStorage.setItem(KEY_KEYWORDS, JSON.stringify(formatted))
  } catch {
    /* idem */
  }
}

/** Réplica addKeyword (L69-108): dedup case-insensitive actualiza el área. */
export function upsertKeyword(keyword: string, printerArea: PrintArea): ProductKeyword[] {
  const kw = keyword.trim().toUpperCase()
  if (kw === '') return loadKeywords()
  const area = normalizePrinterArea(printerArea)
  const keywords = loadKeywords()
  const existing = keywords.findIndex((k) => k.keyword.toLowerCase() === kw.toLowerCase())
  if (existing >= 0) {
    keywords[existing] = { ...keywords[existing], keyword: kw, printerArea: area }
  } else {
    keywords.push({
      id: keywords.length > 0 ? Math.max(...keywords.map((k) => k.id)) + 1 : 1,
      keyword: kw,
      printerArea: area,
      sortOrder: keywords.length,
    })
  }
  saveKeywords(keywords)
  return keywords
}

/** Réplica deleteKeyword (L110-123). */
export function deleteKeyword(id: number): ProductKeyword[] {
  const keywords = loadKeywords().filter((k) => k.id !== id)
  saveKeywords(keywords)
  return keywords
}

// ---------------------------------------------------------------------------
// Validación de readiness (réplica validatePrinterReadiness L80-148)
// ---------------------------------------------------------------------------

export interface PrinterReadinessResult {
  isReady: boolean
  message: string
}

/**
 * Valida que haya impresora configurada. La versión ONLINE (probe TCP /
 * spooler) vive en route-print.ts — aquí solo valida configuración guardada
 * (el mensaje exacto del Flutter L90-94 / L113-118).
 */
export function validatePrinterConfigured(): PrinterReadinessResult {
  const main = getMainPrinter()
  if (main == null || main.ip.trim() === '') {
    return {
      isReady: false,
      message: '⚠️ Impresora no configurada. Configúrala en Ajustes > Impresoras.',
    }
  }
  return { isReady: true, message: main.isUsb ? 'Impresora USB lista' : 'Impresora de red lista' }
}
