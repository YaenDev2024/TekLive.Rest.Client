/**
 * TekLive Rest · Admin users store (Fase 7) — mismo patrón que
 * stores/adminCategories.ts / adminProducts.ts (state/loading/error +
 * getters + acciones CRUD con recarga), replicando la carga de
 * manage_users_screen.dart (L45-64: lista TODO y la UI marca inactivos —
 * soloActivos=false). Roles (L66-86: _loadRoles en paralelo).
 *
 * SIN fallback de datos falsos: los usuarios son datos reales del negocio;
 * si el endpoint falla, `error` se llena y la vista muestra el estado de
 * error réplica (icono + mensaje + Reintentar).
 */

import { defineStore } from 'pinia'
import {
  createAdminUser,
  deleteAdminUser,
  getAdminRoles,
  getAdminUsers,
  updateAdminUser,
  type CreateAdminUserPayload,
  type RestAdminUser,
  type RestRoleCatalogItem,
  type UpdateAdminUserPayload,
} from '../api/rest'
import { ApiError } from '../api/client'

export const useAdminUsersStore = defineStore('adminUsers', {
  state: () => ({
    users: [] as RestAdminUser[],
    roles: [] as RestRoleCatalogItem[],
    /** Búsqueda client-side (L24/L88-103: nombre, apepat, apemat, numero). */
    searchQuery: '',
    loading: false,
    rolesLoading: false,
    error: null as string | null,
    rolesError: null as string | null,
  }),

  getters: {
    /**
     * Filtro client-side réplica _filterUsers (L88-103): nombre, apellido
     * (el backend Rest trae firstName/lastName — el apellido compuesto va
     * en lastName), número de empleado y email — case-insensitive.
     */
    filteredUsers(state): RestAdminUser[] {
      const query = state.searchQuery.trim().toLowerCase()
      if (query.length === 0) return state.users
      return state.users.filter((user) => {
        const firstName = user.firstName.toLowerCase()
        const lastName = user.lastName.toLowerCase()
        const numero = user.numeroEmpleado.toLowerCase()
        const email = user.email.toLowerCase()
        return (
          firstName.includes(query) ||
          lastName.includes(query) ||
          numero.includes(query) ||
          email.includes(query)
        )
      })
    },
  },

  actions: {
    /**
     * Carga la lista completa (réplica _loadUsers L45-64 → getUsers() del
     * Flutter que lista todo). `force` re-pide aunque ya haya datos.
     */
    async loadUsers(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.users.length > 0) return

      this.loading = true
      this.error = null
      try {
        const { data } = await getAdminUsers(false) // soloActivos=false: TODO + badge
        this.users = data ?? []
      } catch (err) {
        this.error =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar usuarios: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.users = []
      } finally {
        this.loading = false
      }
    },

    /** Carga el catálogo de roles (réplica _loadRoles L66-86). */
    async loadRoles(force = false): Promise<void> {
      if (this.rolesLoading) return
      if (!force && this.roles.length > 0) return

      this.rolesLoading = true
      this.rolesError = null
      try {
        const { data } = await getAdminRoles()
        this.roles = data ?? []
      } catch (err) {
        this.rolesError =
          err instanceof ApiError && err.status !== 0
            ? err.message
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.roles = []
      } finally {
        this.rolesLoading = false
      }
    },

    /** POST + recarga al éxito (patrón adminCategories.createCategory). */
    async createUser(body: CreateAdminUserPayload): Promise<void> {
      await createAdminUser(body)
      await this.loadUsers(true)
    },

    /** PUT + recarga al éxito (patrón adminCategories.updateCategory). */
    async updateUser(userId: number, body: UpdateAdminUserPayload): Promise<void> {
      await updateAdminUser(userId, body)
      await this.loadUsers(true)
    },

    /**
     * DELETE soft (isActive=false + floors desactivados) + recarga.
     * Para REACTIVAR se usa reactivateUser (PUT con isActive=true — el
     * backend no tiene un DELETE inverso; el PUT del mismo endpoint reactiva).
     */
    async deactivateUser(userId: number): Promise<void> {
      await deleteAdminUser(userId)
      await this.loadUsers(true)
    },

    /** Reactivar = PUT con isActive=true + recarga (mismo endpoint editar). */
    async reactivateUser(userId: number, current: RestAdminUser): Promise<void> {
      await updateAdminUser(userId, {
        firstName: current.firstName,
        lastName: current.lastName,
        email: current.email,
        role: current.role,
        isActive: true,
        password: null,
      })
      await this.loadUsers(true)
    },
  },
})
