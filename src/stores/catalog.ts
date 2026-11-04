/**
 * TekLive Rest · Catalog store (Fase 3a).
 *
 * Fetch-once por planta con caché en memoria + loading/error + refetch manual.
 *
 * ⚠️ SWITCH MOCK → API REAL (QA ronda 3): flip mock→API real hecho
 *   (USE_MOCK = false). `fetchCatalog()` llama a `getCatalog()` de
 *   src/api/rest.ts (endpoint real GET /api/rest/catalog). El mock queda como
 *   fallback de desarrollo.
 */

import { defineStore } from 'pinia'
import { getCatalog } from '../api/rest'
import { ApiError } from '../api/client'
import type { Catalog } from '../api/pos-types'
import { MOCK_CATALOG } from '../mocks/catalog'

const USE_MOCK = false

/** Planta/sucursal fijas para el POS Piso 1 (Fase 3 ronda 1). */
export const POS_PLANT_ID = 1
export const POS_SUCURSAL_ID = 1

export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    catalog: null as Catalog | null,
    /** Planta del catálogo cacheado (invalida caché si cambia). */
    cachedPlantId: null as number | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    /** Caché válida para la planta indicada. */
    hasCacheForPlant(state): (plantId: number) => boolean {
      return (plantId) => state.cachedPlantId === plantId && state.catalog != null
    },
  },

  actions: {
    /**
     * Fetch-once por planta: si ya hay caché de esa planta, no re-pide.
     * `force` fuerza refetch manual (botón reintentar / pull-to-refresh).
     */
    async fetchCatalog(plantId: number = POS_PLANT_ID, force = false): Promise<void> {
      if (!force && this.hasCacheForPlant(plantId)) return
      if (this.loading) return

      this.loading = true
      this.error = null

      try {
        if (USE_MOCK) {
          // Mock: latencia mínima para que se vea el spinner en QA visual.
          await new Promise((resolve) => setTimeout(resolve, 250))
          this.catalog = structuredClone(MOCK_CATALOG)
        } else {
          const { data } = await getCatalog(plantId, POS_SUCURSAL_ID)
          this.catalog = data
        }
        this.cachedPlantId = plantId
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar el catálogo: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.catalog = null
        this.cachedPlantId = null
      } finally {
        this.loading = false
      }
    },

    /** Refetch manual (ignora caché). */
    async refetchCatalog(): Promise<void> {
      await this.fetchCatalog(this.cachedPlantId ?? POS_PLANT_ID, true)
    },
  },
})
