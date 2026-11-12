/**
 * TekLive Rest · Admin promotions store (Fase admin M1) — mismo patrón que
 * stores/adminCategories.ts (estado/items/loading/error + acciones CRUD con
 * recarga), replicando el listado de create_promo.dart (la tabla inferior
 * del form; allí era mock "No API service for promos yet" — aquí es el CRUD
 * real api/rest/promotions del backend 7ffe922).
 *
 * SIN fallback de datos falsos: las promociones son datos reales del negocio;
 * si el endpoint falla (p.ej. API local aún sin la ruta), `error` se llena y
 * la vista muestra el estado de error réplica (icono + mensaje + Reintentar).
 */

import { defineStore } from 'pinia'
import {
  createPromotion,
  deletePromotion,
  getPromotions,
  updatePromotion,
  type RestPromotion,
  type SavePromotionPayload,
} from '../api/rest'
import { ApiError } from '../api/client'

export const useAdminPromotionsStore = defineStore('adminPromotions', {
  state: () => ({
    promotions: [] as RestPromotion[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    /**
     * El backend ya lista Id DESC — aquí se respeta el orden server (sin
     * re-sort client-side: el orden de creación DESC es el esperado).
     */
    all(state): RestPromotion[] {
      return state.promotions
    },
  },

  actions: {
    /** Carga la lista completa. `force` re-pide aunque ya haya datos. */
    async loadPromotions(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.promotions.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getPromotions()
        this.promotions = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar las promociones: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.promotions = []
      } finally {
        this.loading = false
      }
    },

    /** POST + recarga al éxito (patrón adminCategories.createCategory). */
    async createPromotion(body: SavePromotionPayload): Promise<void> {
      await createPromotion(body)
      await this.loadPromotions(true)
    },

    /** PUT + recarga al éxito (patrón adminCategories.updateCategory). */
    async updatePromotion(promotionId: number, body: SavePromotionPayload): Promise<void> {
      await updatePromotion(promotionId, body)
      await this.loadPromotions(true)
    },

    /** DELETE soft + recarga al éxito (patrón adminCategories.deleteCategory). */
    async deletePromotion(promotionId: number): Promise<void> {
      await deletePromotion(promotionId)
      await this.loadPromotions(true)
    },
  },
})
