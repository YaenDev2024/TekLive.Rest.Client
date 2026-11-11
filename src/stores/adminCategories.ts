/**
 * TekLive Rest · Admin categories store (Fase 6.2) — mismo patrón que
 * stores/adminCatalog.ts (estado/items/loading/error + acciones CRUD con
 * recarga), replicando la carga de create_categorias.dart (L66-89: la vista
 * admin carga SOLO con sucursalId, sin plantId — con el backend nuevo el GET
 * devuelve GLOBAL + SUCURSAL + todas las PLANT).
 *
 * SIN fallback de datos falsos: las categorías son datos reales del negocio;
 * si el endpoint falla (p.ej. backend aún sin la ruta), `error` se llena y la
 * vista muestra el estado de error réplica (icono + mensaje + Reintentar).
 */

import { defineStore } from 'pinia'
import {
  createAdminCategory,
  deleteAdminCategory,
  getAdminCategories,
  updateAdminCategory,
  type RestAdminCategory,
  type SaveAdminCategoryPayload,
} from '../api/rest'
import { ApiError } from '../api/client'
import { POS_SUCURSAL_ID } from './catalog'

export const useAdminCategoriesStore = defineStore('adminCategories', {
  state: () => ({
    categories: [] as RestAdminCategory[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    /**
     * Sort createdAt DESC (nulls al final) — mismo criterio que
     * adminCatalog.filteredItems (L86-91 de manage_catalog_screen.dart).
     */
    sortedCategories(state): RestAdminCategory[] {
      return [...state.categories].sort((a, b) => {
        if (a.createdAt == null && b.createdAt == null) return 0
        if (a.createdAt == null) return 1 // nulls al final
        if (b.createdAt == null) return -1
        return b.createdAt.localeCompare(a.createdAt) // DESC
      })
    },
  },

  actions: {
    /**
     * Carga la lista completa (réplica _refreshCategoriesList L66-89 del
     * Flutter: SOLO sucursalId). `force` re-pide aunque ya haya datos.
     */
    async loadCategories(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.categories.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getAdminCategories(POS_SUCURSAL_ID)
        this.categories = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar las categorías: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.categories = []
      } finally {
        this.loading = false
      }
    },

    /** POST + recarga al éxito (patrón adminCatalog.createItem). */
    async createCategory(body: SaveAdminCategoryPayload): Promise<void> {
      await createAdminCategory(body)
      await this.loadCategories(true)
    },

    /** PUT + recarga al éxito (patrón adminCatalog.updateItem). */
    async updateCategory(categoryId: number, body: SaveAdminCategoryPayload): Promise<void> {
      await updateAdminCategory(categoryId, body)
      await this.loadCategories(true)
    },

    /** DELETE soft + recarga al éxito (patrón adminCatalog.deactivateItem). */
    async deleteCategory(categoryId: number): Promise<void> {
      await deleteAdminCategory(categoryId)
      await this.loadCategories(true)
    },
  },
})
