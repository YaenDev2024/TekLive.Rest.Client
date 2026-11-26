/**
 * TekLive Rest · Guard de instalación del updater.
 *
 * Por qué existe: instalar la actualización cierra la app (NSIS passive en
 * Windows, instalador del sistema en Android). En un punto de venta eso no
 * puede pasar con una venta a medio capturar: el carrito vive SOLO en memoria
 * de Pinia y se perdería sin dejar rastro.
 *
 * Qué NO se comprueba, a propósito: la caja abierta. La sesión de caja es del
 * servidor (`openCashSession` / `fetchCurrent`) y sobrevive a cerrar la app, así
 * que bloque por caja abierta dejaría el restaurante sin poder actualizar
 * nunca durante el turno.
 *
 * Regla de oro: **fail-open**. Sólo bloquea cuando sabe positivamente que hay
 * algo en riesgo. Si Pinia todavía no está montado o el store no responde, se
 * deja actualizar.
 */

import { useCartStore } from '../stores/cart'

export interface InstallGuardResult {
  ok: boolean
  reason?: string
}

const REASON_CART_DIRTY =
  'Hay una orden a medio capturar. Termínala o cancélala antes de actualizar.'

/**
 * ¿Se puede instalar la actualización ahora? Nunca lanza: cualquier fallo
 * interno se traduce en `{ ok: true }`.
 */
export async function canInstallNow(): Promise<InstallGuardResult> {
  try {
    // El store se instancia aquí y no al importar el módulo: `useCartStore()`
    // exige que Pinia ya esté montado.
    const cart = useCartStore()
    if (!cart.isEmpty) return { ok: false, reason: REASON_CART_DIRTY }
  } catch {
    // Pinia sin montar o store roto: no se puede afirmar que haya riesgo.
  }
  return { ok: true }
}
