/**
 * TekLive Rest · Cash store (ronda cash) — réplica de CashSessionProvider de
 * CrazyWings (lib/providers/cash_session_provider.dart) adaptada al API Rest:
 *
 * - current: sesión de caja ABIERTA del (plant, sucursal) del POS, o null.
 * - fetchCurrent al montar las vistas que cobran (checkout, pendientes, caja).
 * - breakdown/reconciliation: datos del arqueo (solo lectura de la vista Caja).
 * - closeSession: al éxito limpia la sesión — el COMPONENTE hace el
 *   clearSession() de auth + redirect a /login (réplica del logout del
 *   Flutter en cash_drawer_screen.dart L1128-1133; aquí el router no toca
 *   el store para no acoplar navegación con estado de API).
 */

import { defineStore } from 'pinia'
import { ApiError } from '../api/client'
import {
  closeCashSession,
  getCashReconciliation,
  getCurrentCashSession,
  getDollarRate,
  getSessionBreakdown,
  openCashSession,
  saveCashReconciliation,
  updateDollarRate,
} from '../api/rest'
import type {
  CashSession,
  CloseCashSessionPayload,
  CloseCashSessionResponse,
  DollarRate,
  Reconciliation,
  SaveReconciliationPayload,
  SessionBreakdown,
} from '../api/pos-types'
import { POS_PLANT_ID, POS_SUCURSAL_ID } from './catalog'

export const useCashStore = defineStore('cash', {
  state: () => ({
    /** Sesión ABIERTA actual (null = caja cerrada). */
    current: null as CashSession | null,
    breakdown: null as SessionBreakdown | null,
    reconciliation: null as Reconciliation | null,
    /** Tasa USD del sistema (null = sin configurar → bloquea pago en dólares). */
    dollarRate: null as DollarRate | null,
    loadingCurrent: false,
    error: null as string | null,
  }),

  getters: {
    /** Gate de cobro: hay sesión abierta (réplica hasActiveSession del Flutter). */
    hasOpenSession(state): boolean {
      return state.current != null && state.current.status === 'OPEN'
    },

    /** Id de la sesión activa (0 si no hay — nunca enviar 0 al backend). */
    sessionId(state): number {
      return state.current?.id ?? 0
    },

    /** Tasa numérica (0 = no configurada). */
    rate(state): number {
      return state.dollarRate?.rate ?? 0
    },
  },

  actions: {
    /**
     * Abre sesión con el monto inicial (réplica startSession del provider +
     * diálogo de module_selection_screen.dart L113-168).
     *
     * Fase 4: `plantId` parametrizado (default POS_PLANT_ID = piso 1 para no
     * romper los call sites de Caja/Checkout) — el selector de módulos abre
     * caja por piso con el plantId del card tocado.
     */
    async openSession(startingAmount: number, plantId: number = POS_PLANT_ID): Promise<CashSession> {
      this.error = null
      try {
        const { data } = await openCashSession({
          startingAmount,
          plantId,
          sucursalId: POS_SUCURSAL_ID,
        })
        this.current = data
        return data
      } catch (err) {
        this.error = err instanceof ApiError && err.status !== 0
          ? err.message
          : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        throw err
      }
    },

    /** GET current → current (null si no hay). Idempotente y barato.
     *  Fase 4: `plantId` parametrizado (default piso 1 — ver openSession). */
    async fetchCurrent(plantId: number = POS_PLANT_ID): Promise<CashSession | null> {
      if (this.loadingCurrent) return this.current
      this.loadingCurrent = true
      this.error = null
      try {
        const { data } = await getCurrentCashSession(plantId, POS_SUCURSAL_ID)
        // Solo sesiones OPEN cuentan como "caja abierta".
        this.current = data != null && data.status === 'OPEN' ? data : null
        return this.current
      } catch (err) {
        this.error = err instanceof ApiError && err.status !== 0
          ? err.message
          : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        return null
      } finally {
        this.loadingCurrent = false
      }
    },

    /** Desglose de ventas por método de la sesión activa. */
    async fetchBreakdown(): Promise<SessionBreakdown | null> {
      if (!this.hasOpenSession) return null
      try {
        const { data } = await getSessionBreakdown(this.sessionId)
        this.breakdown = data
        return data
      } catch (err) {
        this.error = err instanceof ApiError && err.status !== 0
          ? err.message
          : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        return null
      }
    },

    /** Arqueo persistido (null = primero del día). */
    async fetchReconciliation(): Promise<Reconciliation | null> {
      if (!this.hasOpenSession) return null
      try {
        const { data } = await getCashReconciliation(this.sessionId)
        this.reconciliation = data
        return data
      } catch (err) {
        this.error = err instanceof ApiError && err.status !== 0
          ? err.message
          : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        return null
      }
    },

    /** PUT arqueo (los inputs actuales de la vista Caja). */
    async saveReconciliation(payload: SaveReconciliationPayload): Promise<Reconciliation> {
      const { data } = await saveCashReconciliation(this.sessionId, payload)
      this.reconciliation = data
      return data
    },

    /**
     * Cierre definitivo (réplica closeSession + confirmación del Flutter).
     * Al éxito limpia la sesión LOCAL: el componente hace clearSession() de
     * auth + router.push('/login') — el store no navega.
     */
    async closeSession(payload: CloseCashSessionPayload): Promise<CloseCashSessionResponse> {
      const { data } = await closeCashSession(this.sessionId, payload)
      this.reset()
      return data
    },

    /** Tasa USD (null si no está configurada — pago en dólares bloqueado). */
    async fetchDollarRate(): Promise<DollarRate | null> {
      try {
        const { data } = await getDollarRate()
        this.dollarRate = data
        return data
      } catch {
        // La tasa es complementaria: un fallo no rompe la vista (rate 0).
        this.dollarRate = null
        return null
      }
    },

    /** PUT tasa USD (tile de Ajustes). */
    async updateDollarRate(rate: number): Promise<DollarRate> {
      const { data } = await updateDollarRate({ rate })
      this.dollarRate = data
      return data
    },

    /** Limpia TODO el estado (logout / cierre exitoso). */
    reset(): void {
      this.current = null
      this.breakdown = null
      this.reconciliation = null
      // La tasa dólar sobrevive al cierre (es configuración, no sesión).
      this.error = null
    },
  },
})
