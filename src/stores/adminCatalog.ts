/**
 * TekLive Rest · Admin catalog store (Fase 6.1) — réplica EXACTA del estado
 * de _ManageCatalogScreenState (manage_catalog_screen.dart L16-96):
 *
 * - items[]/loading/error ← _items/_isLoading/_errorMessage (L18-21).
 * - searchQuery/selectedFilter ← _searchQuery/_selectedFilter (L22-23), con
 *   selectedFilter en 'TODOS'|tipo (L27-35).
 * - loadItems(force?) ← _loadItems (L43-68): SIN plantId — con el backend
 *   nuevo, getCatalogItems con plantId=null devuelve GLOBAL + SUCURSAL +
 *   todas las PLANT (comentario L51-52 del original). Pasa
 *   selectedSucursalId → aquí la constante POS_SUCURSAL_ID de stores/catalog.ts.
 * - createItem/updateItem/deactivateItem ← _showCreateDialog/_showEditDialog/
 *   _deleteItem (los 3 recargan la lista al éxito — L223/L376/L421).
 * - filteredItems ← _applyFilter (L70-96): filtro de tipo + búsqueda
 *   case-insensitive por nombre/descripcion + sort createdAt DESC con
 *   nulls al final (L87-91 usa epoch 0 para nulls — aquí nulls al final
 *   del todo, igual efecto). Client-side: la carga NO depende del scope
 *   (el ScopeSelector de la vista SOLO prefija los dialogs — L104-105/L248-249).
 *
 * SIN fallback de datos falsos: los items son datos reales del negocio; si
 * el endpoint falla (p.ej. backend aún sin la ruta), `error` se llena y la
 * vista muestra el estado de error réplica (icono + mensaje + Reintentar).
 */

import { defineStore } from 'pinia'
import {
  createAdminCatalogItem,
  getAdminCatalogItems,
  deactivateAdminCatalogItem,
  updateAdminCatalogItem,
  type CreateAdminCatalogItemPayload,
  type RestAdminCatalogItem,
  type UpdateAdminCatalogItemPayload,
} from '../api/rest'
import { ApiError } from '../api/client'
import { POS_SUCURSAL_ID } from './catalog'

/** Tipos del original (_tipos L27-35) — 'TODOS' solo filtra, no crea. */
export const CATALOG_ITEM_TIPOS = [
  'TODOS',
  'SALSA',
  'PROTEINA',
  'COMPLEMENTO',
  'EXTRA',
  'BEBIDA',
  'MODIFICADOR',
] as const

export type CatalogTipoFilter = (typeof CATALOG_ITEM_TIPOS)[number]

export const useAdminCatalogStore = defineStore('adminCatalog', {
  state: () => ({
    items: [] as RestAdminCatalogItem[],
    loading: false,
    error: null as string | null,
    searchQuery: '',
    selectedFilter: 'TODOS' as CatalogTipoFilter,
  }),

  getters: {
    /**
     * Réplica _applyFilter (L70-96): tipo → búsqueda → sort createdAt DESC
     * (nulls al final). Computado: se recalcula solo cuando cambia
     * items/searchQuery/selectedFilter (equivalente a los setState + _applyFilter).
     */
    filteredItems(state): RestAdminCatalogItem[] {
      let filtered = state.items

      // Aplicar filtro de tipo (L74-76)
      if (state.selectedFilter !== 'TODOS') {
        filtered = filtered.filter((item) => item.tipo === state.selectedFilter)
      }

      // Aplicar búsqueda (L79-84): nombre O descripcion, case-insensitive
      const query = state.searchQuery.trim().toLowerCase()
      if (query.length > 0) {
        filtered = filtered.filter(
          (item) =>
            item.nombre.toLowerCase().includes(query) ||
            (item.descripcion?.toLowerCase().includes(query) ?? false),
        )
      }

      // Ordenar por fecha de captura, más recientes primero (L86-91).
      // El original usa epoch 0 como fallback de null → los null quedan
      // al final con cualquier fecha real; aquí se ordenan explícitamente.
      return [...filtered].sort((a, b) => {
        if (a.createdAt == null && b.createdAt == null) return 0
        if (a.createdAt == null) return 1 // nulls al final
        if (b.createdAt == null) return -1
        return b.createdAt.localeCompare(a.createdAt) // DESC
      })
    },
  },

  actions: {
    /**
     * Réplica _loadItems (L43-68). `force` re-pide aunque ya haya datos
     * (botón Recargar / Reintentar). Con force=false y datos presentes no
     * re-pide (evita flicker al volver de un dialog que ya recargó).
     */
    async loadItems(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.items.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getAdminCatalogItems(POS_SUCURSAL_ID)
        this.items = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar el catálogo: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.items = []
      } finally {
        this.loading = false
      }
    },

    /** Réplica createCatalogItem (L207-216) + recarga al éxito (L223). */
    async createItem(body: CreateAdminCatalogItemPayload): Promise<void> {
      await createAdminCatalogItem(body)
      await this.loadItems(true)
    },

    /** Réplica updateCatalogItem (L358-369) + recarga al éxito (L376). */
    async updateItem(itemId: number, body: UpdateAdminCatalogItemPayload): Promise<void> {
      await updateAdminCatalogItem(itemId, body)
      await this.loadItems(true)
    },

    /** Réplica deleteCatalogItem (soft) + recarga al éxito (L421). */
    async deactivateItem(itemId: number): Promise<void> {
      await deactivateAdminCatalogItem(itemId)
      await this.loadItems(true)
    },
  },
})
