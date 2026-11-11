/**
 * TekLive Rest · Admin products store (Fase 6.3) — mismo patrón que
 * stores/adminCatalog.ts y adminCategories.ts: state loading/error + acciones
 * CRUD con recarga. La carga es una sola con sucursalId (el GET del backend
 * devuelve GLOBAL + SUCURSAL + todas las PLANT con scopes[] por producto).
 *
 * SIN fallback de datos falsos: los productos son datos reales del negocio.
 */

import { defineStore } from 'pinia'
import {
  createAdminProduct,
  deleteAdminProduct,
  getAdminProducts,
  updateAdminProduct,
  type CreateAdminProductPayload,
  type RestAdminProduct,
  type UpdateAdminProductPayload,
} from '../api/rest'
import { ApiError } from '../api/client'
import { POS_SUCURSAL_ID } from './catalog'

export const useAdminProductsStore = defineStore('adminProducts', {
  state: () => ({
    products: [] as RestAdminProduct[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    /**
     * Sort createdAt DESC (nulls al final) — mismo criterio que
     * adminCatalog.filteredItems (L86-91 de manage_catalog_screen.dart).
     */
    sortedProducts(state): RestAdminProduct[] {
      return [...state.products].sort((a, b) => {
        if (a.createdAt == null && b.createdAt == null) return 0
        if (a.createdAt == null) return 1 // nulls al final
        if (b.createdAt == null) return -1
        return b.createdAt.localeCompare(a.createdAt) // DESC
      })
    },
  },

  actions: {
    /** GET lista completa con sucursalId. `force` re-pide aunque haya datos. */
    async loadProducts(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.products.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getAdminProducts(POS_SUCURSAL_ID)
        this.products = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar los productos: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.products = []
      } finally {
        this.loading = false
      }
    },

    /** POST + recarga al éxito (patrón adminCatalog.createItem). */
    async createProduct(body: CreateAdminProductPayload): Promise<void> {
      await createAdminProduct(body)
      await this.loadProducts(true)
    },

    /** PUT + recarga al éxito (patrón adminCatalog.updateItem). */
    async updateProduct(productId: number, body: UpdateAdminProductPayload): Promise<void> {
      await updateAdminProduct(productId, body)
      await this.loadProducts(true)
    },

    /** DELETE soft + recarga al éxito (patrón adminCatalog.deactivateItem). */
    async deleteProduct(productId: number): Promise<void> {
      await deleteAdminProduct(productId)
      await this.loadProducts(true)
    },
  },
})
