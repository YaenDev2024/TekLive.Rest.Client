<script setup lang="ts">
/**
 * AdminSummaryView · "Resumen de Caja" (Fase admin M3) — réplica de
 * lib/screens/admin/admin_summary_screen.dart (CrazyWings, 851 líneas) con
 * la estructura de ManageUsersView.vue: AppBar standalone + filtros +
 * estado loading/error con Reintentar + guard de rol.
 *
 * Layout del brief (read-only de una query — SIN store Pinia):
 * - Filtros arriba: fecha (input type=date, default HOY) + ScopeSelector
 *   (alcance) + botón Consultar/Recargar. Réplica L45-65 (_fetchSummary):
 *   sucursalId solo cuando alcance != GLOBAL; plantId solo con PLANT;
 *   PLANT sin piso → lista vacía sin llamar a la API (L54-56) — aquí el
 *   botón Consultar avisa con toast y no consulta.
 * - Totales destacados (cards): Efectivo, Tarjeta, Transferencia, Dólares,
 *   Otros, GRAN TOTAL (grande/primario) — del objeto totals del backend
 *   (efectivo+tarjeta+transferencia+dolares+otros = granTotal, réplica
 *   del cálculo L192-217 del Flutter pero SERVER-side).
 * - Tabla/cards de sesiones: userName, Id (folio), estado badge OPEN
 *   verde/CERRADA gris, Piso #N, startingAmount, calculatedSales,
 *   closingAmount, difference (badge rojo si != 0).
 * - Sección 'Por usuario': cards userName + total + nº sesiones (ya viene
 *   ordenado por total DESC del backend — L543-562 réplica Resumen
 *   General + TOTAL GENERAL).
 * - Estado vacío 'No hay sesiones para esta fecha' (L363-370) + loading
 *   (spinner) + error con Reintentar (réplica ManageUsersView).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarDays, CircleAlert, RefreshCw, Search } from 'lucide-vue-next'
import ScopeSelector from '../../components/admin/ScopeSelector.vue'
import type { ScopeValue } from '../../components/admin/ScopeSelector.vue'
import { AppSpinner } from '../../components/ui'
import { getCashSummary, type RestCashSummary } from '../../api/rest'
import { ApiError } from '../../api/client'
import { session } from '../../services/auth'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import { useToastStore } from '../../stores/toast'

const router = useRouter()
const toast = useToastStore()

// --- Guard de rol (copia EXACTA de ManageCategoriesView onMounted) -----------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void fetchSummary()
})

// --- goBack: back arrow del AppBar → admin-dashboard --------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Filtros (fecha default HOY local + alcance) -------------------------------

/** HOY en formato yyyy-MM-dd (zona local — la fecha de negocio la resuelve
 *  el backend con RestBusinessClock UTC-6; el input date es la UI). */
function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const date = ref(todayIso())
const scope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })

// --- Estado de la consulta (FutureBuilder → refs loading/error/summary) -------

const loading = ref(false)
const error = ref<string | null>(null)
const summary = ref<RestCashSummary | null>(null)
/** true cuando ya se hizo al menos una consulta (para distinguir vacío inicial). */
const queried = ref(false)

/** GET summary (réplica _fetchSummary L45-65). */
async function fetchSummary(): Promise<void> {
  if (loading.value) return
  if (scope.value.scopeType === 'PLANT' && scope.value.plantId == null) {
    // réplica L54-56: Future.value([]) — no llama a la API
    toast.warning('Selecciona un piso para consultar el resumen')
    summary.value = null
    queried.value = true
    return
  }
  loading.value = true
  error.value = null
  try {
    const { data } = await getCashSummary({
      date: date.value,
      scopeType: scope.value.scopeType,
      sucursalId: scope.value.scopeType === 'GLOBAL' ? undefined : POS_SUCURSAL_ID, // L49-50
      plantId: scope.value.scopeType === 'PLANT' ? scope.value.plantId : null, // L51
    })
    summary.value = data
    queried.value = true
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status !== 0
        ? `Error al cargar el resumen: ${err.message}`
        : 'No se pudo conectar con el servidor. Verifica tu conexión.'
    summary.value = null
    queried.value = true
  } finally {
    loading.value = false
  }
}

// --- Helpers de display ----------------------------------------------------------

/** Formato moneda 'MXN X' (mismo es-MX que CashDrawerView). */
function formatMoney(amount: number | null | undefined): string {
  const value = amount ?? 0
  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `MXN ${formatted}`
}

/** Hora 'HH:mm' de un ISO (réplica closeTime L584-586; '--:--' si null). */
function formatTime(iso: string | null | undefined): string {
  if (iso == null || iso.length === 0) return '--:--'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '--:--'
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

const sessions = computed(() => summary.value?.sessions ?? [])
const totals = computed(() => summary.value?.totals ?? null)
const porUsuario = computed(() => totals.value?.porUsuario ?? [])
</script>

<template>
  <div class="as-page">
    <!-- ===== AppBar réplica L241-249: back + título + refresh ===== -->
    <header class="as-appbar">
      <button
        type="button"
        class="as-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="as-back"
        @click="goBack"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="as-appbar-title">Resumen de Caja</h1>
      <div class="as-appbar-actions">
        <button
          type="button"
          class="as-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="as-refresh"
          @click="fetchSummary"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="as-body">
      <!-- ===== Filtros (L252-354): fecha + alcance + Consultar ===== -->
      <section class="as-filters" data-testid="as-filters">
        <div class="as-filter-row">
          <div class="as-field">
            <label class="as-label" for="as-date">Fecha</label>
            <div class="as-date-wrap">
              <CalendarDays :size="18" class="as-date-icon" aria-hidden="true" />
              <input
                id="as-date"
                v-model="date"
                type="date"
                class="as-input as-input--date"
                data-testid="as-date"
                @change="fetchSummary"
              />
            </div>
          </div>
          <button
            type="button"
            class="as-btn as-btn--primary"
            data-testid="as-query"
            :disabled="loading"
            @click="fetchSummary"
          >
            <Search :size="18" aria-hidden="true" />
            Consultar
          </button>
        </div>
        <!-- ScopeSelector ya renderiza su label 'Alcance' y la línea
             'Sucursal actual: N'; antes se repetían aquí (texto duplicado
             visible). El dato sigue en el selector. -->
        <ScopeSelector v-model="scope" />
      </section>

      <!-- ===== Resultado: spinner / error / vacío / datos ===== -->
      <div class="as-list-wrap">
        <div v-if="loading" class="as-state" data-testid="as-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="error != null" class="as-state" data-testid="as-error">
          <CircleAlert :size="64" class="as-state-error-icon" aria-hidden="true" />
          <p class="as-state-text">{{ error }}</p>
          <button
            type="button"
            class="as-retry"
            data-testid="as-retry"
            @click="fetchSummary"
          >
            Reintentar
          </button>
        </div>

        <p
          v-else-if="!queried || sessions.length === 0"
          class="as-state as-empty"
          data-testid="as-empty"
        >
          No hay sesiones para esta fecha
        </p>

        <template v-else>
          <!-- ===== Totales destacados (cards) ===== -->
          <h2 class="as-section-title" data-testid="as-totales-title">Resumen del Día</h2>
          <div class="as-totals" data-testid="as-totales">
            <div class="as-total-card" data-testid="as-total-efectivo">
              <span class="as-total-label">Efectivo</span>
              <span class="as-total-value">{{ formatMoney(totals?.efectivo) }}</span>
            </div>
            <div class="as-total-card" data-testid="as-total-tarjeta">
              <span class="as-total-label">Tarjeta</span>
              <span class="as-total-value">{{ formatMoney(totals?.tarjeta) }}</span>
            </div>
            <div class="as-total-card" data-testid="as-total-transferencia">
              <span class="as-total-label">Transferencia</span>
              <span class="as-total-value">{{ formatMoney(totals?.transferencia) }}</span>
            </div>
            <div class="as-total-card" data-testid="as-total-dolares">
              <span class="as-total-label">Dólares</span>
              <span class="as-total-value">{{ formatMoney(totals?.dolares) }}</span>
            </div>
            <div class="as-total-card" data-testid="as-total-otros">
              <span class="as-total-label">Otros</span>
              <span class="as-total-value">{{ formatMoney(totals?.otros) }}</span>
            </div>
            <div class="as-total-card as-total-card--grand" data-testid="as-total-gran">
              <span class="as-total-label">GRAN TOTAL</span>
              <span class="as-total-value">{{ formatMoney(totals?.granTotal) }}</span>
            </div>
          </div>

          <!-- ===== Sesiones (cards) ===== -->
          <h2 class="as-section-title" data-testid="as-sesiones-title">Sesiones</h2>
          <ul class="as-list" data-testid="as-sesiones">
            <li
              v-for="sesion in sessions"
              :key="sesion.id"
              class="as-session"
              :data-testid="`as-session-${sesion.id}`"
            >
              <div class="as-session-head">
                <span class="as-session-user">{{ sesion.userName }}</span>
                <span
                  class="as-session-status"
                  :class="sesion.status === 'OPEN' ? 'as-session-status--open' : 'as-session-status--closed'"
                >
                  {{ sesion.status === 'OPEN' ? 'ABIERTA' : 'CERRADA' }}
                </span>
              </div>
              <div class="as-session-meta">
                <span class="as-session-folio">#{{ sesion.id }}</span>
                <span v-if="sesion.plantId != null" class="as-session-plant">Piso #{{ sesion.plantId }}</span>
                <span class="as-session-time">{{ formatTime(sesion.startTime) }} → {{ formatTime(sesion.endTime) }}</span>
              </div>
              <div class="as-session-amounts">
                <div class="as-mini-stat">
                  <span class="as-mini-label">Inicio</span>
                  <span class="as-mini-value">{{ formatMoney(sesion.startingAmount) }}</span>
                </div>
                <div class="as-mini-stat">
                  <span class="as-mini-label">Ventas</span>
                  <span class="as-mini-value">{{ formatMoney(sesion.calculatedSales) }}</span>
                </div>
                <div class="as-mini-stat">
                  <span class="as-mini-label">Cierre</span>
                  <span class="as-mini-value">{{ formatMoney(sesion.closingAmount) }}</span>
                </div>
                <div
                  class="as-mini-stat"
                  :class="(sesion.difference ?? 0) !== 0 ? 'as-mini-stat--diff' : ''"
                  data-testid="as-session-diff"
                >
                  <span class="as-mini-label">Diferencia</span>
                  <span class="as-mini-value">{{ formatMoney(sesion.difference) }}</span>
                </div>
              </div>
            </li>
          </ul>

          <!-- ===== Por usuario (ya viene ordenado total DESC) ===== -->
          <h2 class="as-section-title" data-testid="as-usuarios-title">Por usuario</h2>
          <ul class="as-list" data-testid="as-usuarios">
            <li
              v-for="userTotal in porUsuario"
              :key="userTotal.userId"
              class="as-user"
              :data-testid="`as-user-${userTotal.userId}`"
            >
              <span class="as-user-name">{{ userTotal.userName }}</span>
              <span class="as-user-meta">{{ userTotal.sesiones }} sesión(es)</span>
              <span class="as-user-total">{{ formatMoney(userTotal.total) }}</span>
            </li>
          </ul>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen standalone (mismo layout que
   ManageUsersView: var(--bg), sin rail). */
.as-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, refresh a la derecha ===== */
.as-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) 24px 6px;
  background: var(--bg);
}

.as-appbar-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.as-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton circular 44px (objetivo táctil) con borde sutil */
.as-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-2);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.as-icon-btn:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border);
}

.as-icon-btn:active {
  background: rgba(255, 255, 255, 0.1);
}

/* ===== Cuerpo (máx ~900px: la tabla necesita algo más que el form) ===== */
.as-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

/* ===== Filtros card ===== */
.as-filters {
  margin: 12px 16px 0;
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.as-filter-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.as-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.as-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}

/* Input date (default HOY) con icono calendario */
.as-date-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.as-date-icon {
  position: absolute;
  left: 12px;
  color: var(--text-3);
  pointer-events: none;
}

/* InputDecorationTheme réplica: fill elevado, outline sutil, radius, foco
   naranja en el borde (sin halo grande). */
.as-input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.as-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
}

/* date input: icono a la izquierda, color-scheme dark para el picker */
.as-input--date {
  padding-left: 38px;
  color-scheme: dark;
}

/* ===== Botones ===== */
.as-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 20px;
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  border: 1px solid transparent;
  flex: none;
  min-height: 44px;
  transition: background var(--dur) var(--ease);
}

.as-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.as-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.as-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Lista ===== */
.as-list-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.as-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 52px 24px;
  text-align: center;
}

.as-empty {
  margin: 0;
  padding: 44px 20px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.55;
}

.as-state-error-icon {
  color: var(--error);
}

.as-state-text {
  margin: 0;
  max-width: 34ch;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.55;
}

/* Reintentar: botón secundario, no el CTA principal de la pantalla. */
.as-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 20px;
  background: var(--elevated);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.as-retry:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

/* Section title */
.as-section-title {
  margin: 6px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  color: var(--text-2);
}

/* ===== Totales: GRAN TOTAL como hero + métodos en grid ===== */
.as-totals {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

/* El gran total ocupa toda la fila y se lee primero (jerarquía real). */
.as-total-card--grand {
  grid-column: 1 / -1;
  order: -1;
  padding: 16px 16px 15px;
  gap: 2px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.as-total-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 13px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  min-width: 0;
}

/* Cierra la retícula pareja cuando el número de métodos es impar:
   'Otros' ocupa la fila completa en vez de dejar un hueco muerto. */
.as-total-card:last-child:not(.as-total-card--grand) {
  grid-column: 1 / -1;
}

.as-total-label {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-2);
}

.as-total-value {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

/* GRAN TOTAL: número grande en blanco, etiqueta con punto naranja.
   El naranja se reserva al acento, no al número (mejor lectura). */
.as-total-card--grand .as-total-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.as-total-card--grand .as-total-label::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--primary);
}

.as-total-card--grand .as-total-value {
  font-size: clamp(28px, 8vw, 36px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.1;
  color: var(--text-1);
}

/* ===== Sesiones (cards) ===== */
.as-list {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.as-session {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 15px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
}

.as-session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.as-session-user {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Badge OPEN verde / CERRADA gris */
.as-session-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.045em;
  flex: none;
}

.as-session-status--open {
  background: var(--success-soft);
  color: var(--success);
}

.as-session-status--closed {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-2);
}

.as-session-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.as-session-folio {
  font-weight: 600;
  color: var(--text-1);
}

.as-session-amounts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
  gap: 6px;
}

/* Mini stat */
.as-mini-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  min-width: 0;
}

.as-mini-label {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-3);
}

.as-mini-value {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Diferencia != 0 → badge rojo */
.as-mini-stat--diff {
  background: var(--error-soft);
  border: 1px solid rgba(242, 86, 91, 0.3);
}

.as-mini-stat--diff .as-mini-value {
  color: var(--error);
}

/* ===== Por usuario (réplica Resumen General L543-562) ===== */
.as-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 15px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
}

.as-user-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.as-user-meta {
  font-size: 11.5px;
  color: var(--text-2);
  flex: none;
}

/* El total por usuario NO va naranja: el acento está en el hero. */
.as-user-total {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  flex: none;
}

/* ===== Responsive: móvil ===== */
@media (max-width: 560px) {
  .as-appbar {
    padding: max(12px, env(safe-area-inset-top)) 16px 4px;
  }

  .as-appbar-title {
    font-size: 18px;
  }

  .as-filters {
    margin: 10px 14px 0;
    padding: 13px;
  }

  .as-list-wrap {
    padding: 14px;
  }

  .as-filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  /* Consultar a todo el ancho: es el único CTA de la vista. */
  .as-btn {
    width: 100%;
  }

  .as-totals {
    grid-template-columns: repeat(2, 1fr);
  }

  .as-session-amounts {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
