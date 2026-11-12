/**
 * TekLive Rest · Admin payroll store (Fase admin M4) — mismo patrón que
 * stores/adminPromotions.ts, replicando la carga de empleados y el historial
 * de records de create_nom.dart (_loadEmployees L155-171, historial).
 *
 * El CREATE (POST records) y el DELETE (hard) viven aquí también: el POST
 * devuelve { id, netoPagar } con el neto calculado SERVER-side (el cliente
 * solo muestra su cálculo en vivo para display).
 *
 * SIN fallback de datos falsos: si el endpoint falla, `error`/`employeesError`
 * se llenan y la vista muestra el estado de error réplica.
 */

import { defineStore } from 'pinia'
import {
  createPayrollRecord,
  deletePayrollRecord,
  getPayrollEmployees,
  getPayrollRecords,
  type CreatePayrollRecordPayload,
  type RestPayrollEmployee,
  type RestPayrollRecord,
} from '../api/rest'
import { ApiError } from '../api/client'

export const useAdminPayrollStore = defineStore('adminPayroll', {
  state: () => ({
    employees: [] as RestPayrollEmployee[],
    employeesLoading: false,
    employeesError: null as string | null,
    records: [] as RestPayrollRecord[],
    recordsLoading: false,
    recordsError: null as string | null,
  }),

  actions: {
    /** GET employees (activos; puede venir [] — tabla vacía es válido). */
    async loadEmployees(force = false): Promise<void> {
      if (this.employeesLoading) return
      if (!force && this.employees.length > 0) return

      this.employeesLoading = true
      this.employeesError = null
      try {
        const { data } = await getPayrollEmployees()
        this.employees = data ?? []
      } catch (err) {
        this.employeesError =
          err instanceof ApiError && err.status !== 0
            ? `Error cargando empleados: ${err.message}` // réplica L165
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.employees = []
      } finally {
        this.employeesLoading = false
      }
    },

    /**
     * GET records (historial; orden FechaCreacion DESC server-side).
     * `employeeId` filtra por empleado cuando hay uno seleccionado.
     */
    async loadRecords(force = false, employeeId?: number): Promise<void> {
      if (this.recordsLoading) return
      if (!force && this.records.length > 0) return

      this.recordsLoading = true
      this.recordsError = null
      try {
        const { data } = await getPayrollRecords(
          employeeId != null ? { employeeId } : undefined,
        )
        this.records = data ?? []
      } catch (err) {
        this.recordsError =
          err instanceof ApiError && err.status !== 0
            ? `Error al cargar el historial: ${err.message}`
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        this.records = []
      } finally {
        this.recordsLoading = false
      }
    },

    /** POST records + recarga del historial (SERVER recalcula totales/neto). */
    async createRecord(body: CreatePayrollRecordPayload): Promise<{ id: number; netoPagar: number }> {
      const { data } = await createPayrollRecord(body)
      await this.loadRecords(true)
      return data
    },

    /** DELETE hard + recarga del historial (nómina mal capturada se elimina). */
    async deleteRecord(recordId: number): Promise<void> {
      await deletePayrollRecord(recordId)
      await this.loadRecords(true)
    },
  },
})
