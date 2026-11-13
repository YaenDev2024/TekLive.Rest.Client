/**
 * TekLive Rest · Bridge Tauri (ronda Piso 1) — capa única de acceso al shell
 * de escritorio (src-tauri/src/printing.rs).
 *
 * - Detección: `'__TAURI_INTERNALS__' in window` (Tauri 2 inyecta el objeto
 *   global solo en el webview de escritorio; en navegador/PWA no existe).
 * - `invoke` se importa DINÁMICAMENTE: en web el paquete @tauri-apps/api
 *   puede resolverse pero su llamada fallaría; así el bundle web nunca
 *   ejecuta el canal IPC.
 * - En web: `isTauri() === false` y los wrappers devuelven valores neutros /
 *   throw controlado (los servicios de arriba deciden el fallback browser).
 */

/** true solo dentro del webview Tauri 2 de escritorio. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Impresora instalada en Windows (mirror PrinterInfo de printing.rs). */
export interface TauriPrinter {
  name: string
  isDefault: boolean
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('La impresión directa solo está disponible en la app de escritorio.')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/**
 * Lista las impresoras instaladas (EnumPrintersW). En web → [].
 * Nunca lanza por fallo del spooler: devuelve lista vacía (la UI muestra el
 * input manual).
 */
export async function listPrinters(): Promise<TauriPrinter[]> {
  try {
    return await invoke<TauriPrinter[]>('list_printers')
  } catch {
    return []
  }
}

/**
 * Envía bytes RAW (ESC/POS) a la impresora Windows indicada (WritePrinter
 * datatype RAW). En web lanza error controlado (el caller decide fallback).
 */
export async function printRawEscPos(printerName: string, data: Uint8Array): Promise<void> {
  // Vec<u8> en Rust recibe un array JSON de números (no base64): el puente
  // IPC de Tauri 2 serializa ArrayLike como lista.
  await invoke<void>('print_raw', { printerName, data: Array.from(data) })
}

/**
 * Prueba TCP contra una impresora de red (connect_timeout réplica
 * printer_probe_service.dart). Devuelve true si el puerto responde; throw
 * con mensaje si no (el caller convierte a toast/banner).
 */
export async function probePrinter(ip: string, port = 9100, timeoutMs = 3000): Promise<boolean> {
  return invoke<boolean>('probe_printer', { ip, port, timeoutMs })
}

/**
 * Socket TCP DIRECTO a ip:port con bytes ESC/POS (ronda robustez RED) — el
 * camino real de esc_pos_printer_plus del Flutter (Socket.connect → add →
 * flush → delay → destroy): NO usa el spooler de Windows ni exige impresora
 * instalada, solo conectividad IP. En web lanza error controlado.
 *
 * El shell Rust drena la respuesta de la térmica ~250ms tras el flush antes
 * de cerrar (réplica del socket Dart que vivía 300-1000ms tras el flush).
 */
export async function printTcpEscPos(
  ip: string,
  port: number,
  data: Uint8Array,
  timeoutMs = 2500,
): Promise<void> {
  await invoke<void>('print_tcp', { ip, port, data: Array.from(data), timeoutMs })
}
