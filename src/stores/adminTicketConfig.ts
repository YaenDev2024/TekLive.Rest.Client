/**
 * TekLive Rest · Store de configuración del ticket (ronda Piso 1) — réplica
 * de _fetchTicketConfig (ticket_service.dart L43-74) con las MISMAS defaults.
 *
 * Contrato backend (RestTicketConfigController, envelope { success, data,
 * message }):
 *   GET api/rest/ticket-config → { footer, showKitchenModifiers,
 *     showKitchenNotes, showClientPaidModifiers, showClientFreeModifiers,
 *     showClientNotes }
 *   PUT api/rest/ticket-config (mismo body, footer nullable ≤200).
 *   403 para RestOperator (solo admin/manager guardan).
 *
 * La impresión NUNCA se bloquea: si la carga falla se usan los defaults del
 * Flutter (footer '¡GRACIAS POR SU COMPRA!' + 'Vuelva pronto', flags abajo).
 */

import { defineStore } from 'pinia'
import { getTicketConfig, updateTicketConfig, type TicketConfig } from '../api/rest'
import { ApiError } from '../api/client'

/** Defaults réplica defaultConfig (ticket_service.dart L44-51). */
export const DEFAULT_TICKET_CONFIG: TicketConfig = {
  footer: '¡GRACIAS POR SU COMPRA! Vuelva pronto',
  showKitchenModifiers: true,
  showKitchenNotes: true,
  showClientPaidModifiers: true,
  showClientFreeModifiers: false,
  showClientNotes: true,
}

export const useAdminTicketConfigStore = defineStore('adminTicketConfig', {
  state: () => ({
    /** Config viva; null = aún sin cargar (los lectores usan defaults). */
    config: null as TicketConfig | null,
    loading: false,
    saving: false,
    /** Último error de carga/guardado (message del backend o conexión). */
    error: null as string | null,
  }),

  getters: {
    /**
     * Config efectiva para los builders de tickets: nunca null — si no hay
     * carga (o falló) devuelve los defaults del Flutter. Los lectores
     * (sale-print / TicketPreviewModal / layouts) se quedan aquí.
     */
    effectiveConfig(state): TicketConfig {
      return state.config ?? DEFAULT_TICKET_CONFIG
    },
  },

  actions: {
    /**
     * GET + cache en memoria (patrón adminCategories loadCategories: force
     * re-pide). En fallo NO lanza: deja config en null → defaults.
     */
    async load(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.config != null) return
      this.loading = true
      this.error = null
      try {
        const { data } = await getTicketConfig()
        if (data != null) this.config = data
      } catch (err) {
        // La impresión nunca se bloquea por config: defaults + error para la UI.
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar la configuración: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
      } finally {
        this.loading = false
      }
    },

    /**
     * PUT + cache actualizada. SÍ lanza (la vista muestra el message 403/400
     * del backend réplica SnackBar error).
     */
    async save(next: TicketConfig): Promise<void> {
      this.saving = true
      this.error = null
      try {
        const { data } = await updateTicketConfig(next)
        this.config = data ?? next
      } finally {
        this.saving = false
      }
    },
  },
})
