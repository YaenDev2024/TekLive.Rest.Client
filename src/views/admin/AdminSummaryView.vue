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
        <div class="as-field">
          <span class="as-label">Alcance del reporte</span>
          <ScopeSelector v-model="scope" />
        </div>
        <p class="as-sucursal">Sucursal actual: {{ POS_SUCURSAL_ID }}</p>
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
  padding: 8px;
  background: var(--bg);
}

.as-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.as-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 (patrón ManageUsersView) */
.as-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.as-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
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

/* ===== Filtros card (L252-354) ===== */
.as-filters {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.as-filter-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.as-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.as-label {
  font-size: 12px;
  color: var(--text-faint);
}

/* Input date (default HOY) con icono calendario */
.as-date-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.as-date-icon {
  position: absolute;
  left: 12px;
  color: var(--text-faint);
  pointer-events: none;
}

/* InputDecorationTheme réplica: fill black alpha .3, outline grey[700],
   radius 12, focused deepOrange */
.as-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s ease;
}

.as-input:focus {
  border-color: var(--primary);
}

/* date input: icono a la izquierda, color-scheme dark para el picker */
.as-input--date {
  padding-left: 38px;
  color-scheme: dark;
}

.as-sucursal {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.as-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  flex: none;
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

/* ===== Lista: ListView padding 16 ===== */
.as-list-wrap {
  flex: 1;
  padding: 16px;
}

.as-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.as-empty {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.as-state-error-icon {
  color: var(--error);
}

.as-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar': deepOrange radius 12 bold */
.as-retry {
  padding: 12px 24px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.as-retry:hover {
  background: var(--primary-hover);
}

/* Section title (L416-420 'Resumen del Dia'): 20 bold */
.as-section-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

/* ===== Totales: grid de cards (KPI réplica L424-446) ===== */
.as-totals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.as-total-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.04); /* white .04 (L744) */
  border: 1px solid rgba(255, 255, 255, 0.06); /* white .06 (L746) */
  border-radius: 12px;
}

.as-total-label {
  font-size: 12px;
  color: var(--text-faint);
}

.as-total-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

/* GRAN TOTAL: grande/primario (réplica L563-574 deepOrange .15) */
.as-total-card--grand {
  background: rgba(255, 87, 34, 0.15);
  border-color: var(--primary);
}

.as-total-card--grand .as-total-label {
  color: var(--primary);
  font-weight: 700;
}

.as-total-card--grand .as-total-value {
  font-size: 22px;
  color: var(--primary);
}

/* ===== Sesiones (cards) ===== */
.as-list {
  margin: 0 0 24px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.as-session {
  padding: 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.as-session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.as-session-user {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Badge OPEN verde / CERRADA gris */
.as-session-status {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  flex: none;
}

.as-session-status--open {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.as-session-status--closed {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
}

.as-session-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}

.as-session-folio {
  font-weight: 700;
}

.as-session-amounts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}

/* Mini stat (réplica _miniStat L779-795) */
.as-mini-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
}

.as-mini-label {
  font-size: 11px;
  color: var(--text-faint);
}

.as-mini-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

/* Diferencia != 0 → badge rojo */
.as-mini-stat--diff {
  background: rgba(255, 82, 82, 0.12);
  border: 1px solid rgba(255, 82, 82, 0.4);
}

.as-mini-stat--diff .as-mini-value {
  color: var(--error);
}

/* ===== Por usuario (réplica Resumen General L543-562) ===== */
.as-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.as-user-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.as-user-meta {
  font-size: 12px;
  color: var(--text-faint);
  flex: none;
}

.as-user-total {
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
  flex: none;
}

/* ===== Responsive básico: móvil apila filtros ===== */
@media (max-width: 560px) {
  .as-appbar-title {
    font-size: 19px;
  }

  .as-filters {
    margin: 8px 12px 0;
  }

  .as-list-wrap {
    padding: 12px;
  }

  .as-filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  .as-totals {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
