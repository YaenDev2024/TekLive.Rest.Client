/**
 * TekLive Rest · Admin price-increase store (Fase admin M2) — mismo patrón
 * que stores/adminPromotions.ts, replicando price_increase_config_screen.dart
 * (carga inicial L42-52, save + recarga L69-88, delete + recarga L111-124).
 *
 * ⚠️ El % SOLO se configura (upsert backend): la aplicación al catálogo es
 * otra fase — la vista muestra la nota informativa del brief.
 *
 * SIN fallback de datos falsos: si el endpoint falla (p.ej. API local aún
 * sin la ruta), `error` se llena y la vista muestra el estado de error
 * réplica (icono + mensaje + Reintentar).
 */

import { defineStore } from 'pinia'
import {
  deletePriceIncrease,
  getPriceIncreaseConfigs,
  upsertPriceIncrease,
  type RestPriceIncreaseConfig,
  type UpsertPriceIncreasePayload,
} from '../api/rest'
import { ApiError } from '../api/client'

export const useAdminPriceIncreaseStore = defineStore('adminPriceIncrease', {
  state: () => ({
    configs: [] as RestPriceIncreaseConfig[],
    loading: false,
    error: null as string | null,
  }),

  actions: {
    /** Carga la lista completa (réplica _loadConfigs L42-52). */
    async loadConfigs(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.configs.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getPriceIncreaseConfigs()
        this.configs = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error cargando configuraciones: ${err.message}` // réplica L48
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.configs = []
      } finally {
        this.loading = false
      }
    },

    /**
     * Upsert + recarga al éxito (réplica _saveConfig L69-88): el backend
     * dedupea por (scopeType, sucursalId, plantId) activo — tras guardar se
     * SIEMPRE recarga para reflejar el reemplazo real.
     */
    async upsertConfig(body: UpsertPriceIncreasePayload): Promise<void> {
      await upsertPriceIncrease(body)
      await this.loadConfigs(true)
    },

    /** DELETE soft + recarga al éxito (réplica _deleteConfig L111-124). */
    async deleteConfig(configId: number): Promise<void> {
      await deletePriceIncrease(configId)
      await this.loadConfigs(true)
    },
  },
})
