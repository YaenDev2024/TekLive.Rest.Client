<script setup lang="ts">
/**
 * ModuleSelectView · selector de módulos.
 *
 * LÓGICA: réplica fiel de lib/screens/module_selection_screen.dart
 * (CrazyWings) — permisos, gate de caja por piso y navegación intactos.
 *
 * PRESENTACIÓN: rediseño visual 2026-11-17 (mismo lenguaje premium del hub de
 * Administración, prioridad móvil):
 * - Topbar sticky con logo + botón de salida circular de 44px; safe-area.
 * - Encabezado de identidad (avatar con iniciales + nombre + rol), igual que
 *   AdminDashboardView: una sola lectura, sin duplicar el título de página.
 * - Etiqueta de sección "Módulos" (uppercase, tracking amplio) como el hub.
 * - Cards fila (icono + texto + chevron) en columnas de 900px centradas:
 *   1 columna en móvil, 2 en tablet/desktop. Tile de icono CLARO en
 *   Administración (la firma de la referencia) y tiles neutros en el resto.
 * - Badge DIRECTO dentro de la fila del título (ya no flota sobre la esquina).
 * - Naranja SOLO en el punto del badge, el foco de teclado y el CTA del empty
 *   state: el acento no compite con la navegación.
 *
 * Estructura replicada del original (referencia Flutter):
 * - Permisos (L186-195) mapeados a los roles del JWT Rest:
 *   canAccessPOS: RestAdmin|SuperAdmin|RestManager|RestCashier
 *   canAccessFloor: RestAdmin|SuperAdmin|RestManager|RestKitchen|RestWaiter
 *   canAccessAdmin: RestAdmin|SuperAdmin|RestManager
 * - Flujo card piso (réplica _openModuleForFloor/_openPosForFloor L17-79):
 *   selectFloor → cashStore.fetchCurrent(floorId) → si hay sesión OPEN
 *   navega; si no abre StartCashSessionModal → Iniciar navega / Cancelar no.
 *   Piso 2 (restaurante): ejercita el gate y luego toast informativo.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Banknote,
  ChevronRight,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Store,
  UtensilsCrossed,
} from 'lucide-vue-next'
import { session, clearSession } from '../../services/auth'
import { roleLabel } from '../../utils/role-labels'
import { getCashSummary, getOrders } from '../../api/rest'
import { useFloorsStore } from '../../stores/floors'
import { POS_PLANT_ID } from '../../stores/catalog'
import { useCashStore } from '../../stores/cash'
import { useToastStore } from '../../stores/toast'
import StartCashSessionModal from '../../components/pos/StartCashSessionModal.vue'
import AppSpinner from '../../components/ui/AppSpinner.vue'
import type { RestFloorResponse } from '../../api/rest'

const router = useRouter()
const floorsStore = useFloorsStore()
const cashStore = useCashStore()
const toast = useToastStore()

// onMounted ya existe: los flags de layout se sincronizan ahí (ver bloque
// "Carga inicial") — no hay listener de resize (los breakpoints son CSS).

// --- Header ---------------------------------------------------------------------

const displayName = computed(() => session.displayName ?? '')
const headerRoleLabel = computed(() => roleLabel(session.role))

/** Iniciales del avatar (solo presentación, mismo criterio que el hub admin). */
const initials = computed(() => {
  const parts = (session.displayName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
})

/** Saludo por hora local (presentación; no altera ningún flujo). */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Buen día'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
})

/** Total de módulos visibles para el usuario (mismo criterio que el v-if). */
const moduleCount = computed(() => {
  let n = 0
  if (canAccessAdmin.value) n += 1
  if (canAccessPOS.value) n += 1 + floors.value.length
  else if (canAccessFloor.value) n += 1
  return n
})

async function logout(): Promise<void> {
  floorsStore.reset()
  cashStore.reset()
  clearSession()
  await router.push({ name: 'login' })
}

// --- Permisos (L186-195, mapeo de roles documentado arriba) --------------------

const userRole = computed(() => (session.role ?? '').toLowerCase())
const canAccessPOS = computed(() =>
  ['restadmin', 'superadmin', 'restmanager', 'restcashier'].includes(userRole.value),
)
const canAccessFloor = computed(() =>
  ['restadmin', 'superadmin', 'restmanager', 'restkitchen', 'restwaiter'].includes(userRole.value),
)
const canAccessAdmin = computed(() =>
  ['restadmin', 'superadmin', 'restmanager'].includes(userRole.value),
)

// --- Carga inicial (réplica: FloorProvider.loadFloors al entrar) ----------------

/** Fecha de negocio local YYYY-MM-DD (mismo criterio que PendingOrdersView). */
function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- Hero por rol (solo lectura; NO interfiere con ningún flujo) ---------------
// Admin/Manager → financiero (GET /cash/summary — 403 para cajero, verificado
// en RestCashController). Cajero → operativo (GET /orders?status=pendiente +
// sessions/current). Mesero/Cocina → sin hero (sin números que no le incumben).

interface HeroKpi {
  value: string
  label: string
}

const heroVisible = computed(() => canAccessPOS.value)
const heroVariant = computed<'financiero' | 'operativo'>(() =>
  canAccessAdmin.value ? 'financiero' : 'operativo',
)

const heroLoading = ref(true)
const heroMain = ref<string | null>(null)
const heroMainLabel = ref('')
const heroKpis = ref<HeroKpi[]>([])

/** '—' cuando no hay dato: nunca inventar un 0 que parezca venta real. */
function heroMoney(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Carga tolerante del hero (mismo patrón allSettled que AdminDashboardView):
 * cualquier fallo deja el valor en null ('—') sin afectar módulos ni navegación.
 */
async function loadHero(): Promise<void> {
  if (!heroVisible.value) {
    heroLoading.value = false
    return
  }
  heroLoading.value = true
  if (heroVariant.value === 'financiero') {
    // Admin/Manager: venta del día + métodos de pago + cajas abiertas.
    const summary = await Promise.allSettled([
      getCashSummary({ date: todayIso(), scopeType: 'GLOBAL' }),
    ])
    if (summary[0].status === 'fulfilled') {
      const data = summary[0].value.data
      const totals = data?.totals
      heroMain.value = totals?.granTotal != null ? heroMoney(totals.granTotal) : null
      heroMainLabel.value = 'Venta del día'
      heroKpis.value = [
        { value: heroMoney(totals?.efectivo ?? null), label: 'Efectivo' },
        { value: heroMoney(totals?.tarjeta ?? null), label: 'Tarjeta' },
        {
          value: data?.sessions?.length != null ? String(data.sessions.length) : '—',
          label: 'Cajas del día',
        },
      ]
    }
  } else {
    // Cajero: pendientes de cobro (la MISMA lista que verá en Cuentas por
    // Cobrar al entrar) + su sesión de caja. Un fallo de red NO es "0":
    // se pinta '—' (mismo criterio que el hub admin).
    const [pend, current] = await Promise.allSettled([
      getOrders({ plantId: POS_PLANT_ID, date: todayIso(), status: 'pendiente' }),
      cashStore.fetchCurrent(POS_PLANT_ID),
    ])
    if (pend.status === 'fulfilled') {
      const list = pend.value.data ?? []
      const pendingTotal = list.reduce((acc, o) => acc + (o.total ?? 0), 0)
      heroMain.value = String(list.length)
      heroKpis.value = [{ value: heroMoney(pendingTotal), label: 'Por cobrar' }]
    } else {
      heroMain.value = null
      heroKpis.value = [{ value: '—', label: 'Por cobrar' }]
    }
    heroKpis.value.push({
      value:
        current.status === 'fulfilled'
          ? (current.value != null ? 'Abierta' : 'Cerrada')
          : '—',
      label: 'Tu caja (P1)',
    })
    heroMainLabel.value = 'Pendientes de cobro'
  }
  heroLoading.value = false
}

onMounted(() => {
  void floorsStore.fetchFloors()
  void loadHero()
})

const floors = computed(() => floorsStore.floors)
const isLoadingFloors = computed(() => floorsStore.loading)

// --- Layout responsivo -----------------------------------------------------------
// Los breakpoints viven SOLO en CSS (@media): no hay flags de ancho en JS ni
// listener de resize (el anterior tenía leak). El CSS es la fuente de verdad.

// --- Gate de caja por piso (réplica _openPosForFloor L44-79) --------------------

const navigating = ref(false)
const cashGateFloor = ref<RestFloorResponse | null>(null)
const cashGateTitle = ref<string | undefined>(undefined)

/** Toast piso 2: la vista de mesas no existe aún (fase próxima). */
function navigateToRestaurant(): void {
  toast.info('Sistema de mesas — disponible en una fase próxima')
}

/**
 * Réplica _openModuleForFloor (L17-42): selecciona el piso y abre el gate
 * de caja (piso 2 igual pasa por el gate antes del toast del modo mesas).
 */
async function openModuleForFloor(floor: RestFloorResponse): Promise<void> {
  if (navigating.value) return
  navigating.value = true
  try {
    floorsStore.selectFloor(floor)
    await cashStore.fetchCurrent(floor.floorId)
    if (cashStore.hasOpenSession) {
      afterGateSuccess(floor)
      return
    }
    // Sin sesión: modal réplica L113-168 (Cancelar → no navega).
    cashGateFloor.value = floor
    cashGateTitle.value = undefined
  } finally {
    navigating.value = false
  }
}

/**
 * Réplica _openPaymentsModule (L85-111): gate de caja del piso 2 →
 * /pos/ordenes con título 'Iniciar caja - Planta 2'.
 */
async function openPaymentsModule(): Promise<void> {
  if (navigating.value) return
  navigating.value = true
  try {
    await cashStore.fetchCurrent(2)
    if (cashStore.hasOpenSession) {
      await router.push({ name: 'pos-ordenes' })
      return
    }
    cashGateFloor.value = floorsStore.byId(2) ?? {
      floorId: 2,
      name: 'Planta 2',
      description: null,
    }
    cashGateTitle.value = 'Iniciar caja - Planta 2'
  } finally {
    navigating.value = false
  }
}

/** Tras gate OK (sesión abierta o recién iniciada): navegar. */
function afterGateSuccess(floor: RestFloorResponse): void {
  cashGateFloor.value = null
  if (floorsStore.isRestaurantFloor(floor.floorId)) {
    navigateToRestaurant()
    return
  }
  void router.push({ name: 'pos-piso1' })
}

/** Modal Iniciar: sesión creada → navega (réplica pop(true) → pushNamed). */
function onGateStarted(): void {
  if (cashGateFloor.value != null) afterGateSuccess(cashGateFloor.value)
}

/** Modal Cancelar: cierra sin navegar (réplica pop(false) → return). */
function onGateClosed(): void {
  cashGateFloor.value = null
  cashGateTitle.value = undefined
}

/**
 * Card Administración → hub admin (Fase 5): réplica admin_dashboard_home.dart.
 */
function openAdminModule(): void {
  void router.push({ name: 'admin-dashboard' })
}

// --- Descripciones de cards (L394-396) ------------------------------------------

function floorSubtitle(floor: RestFloorResponse): string {
  return floorsStore.isRestaurantFloor(floor.floorId) ? 'Sistema de mesas' : 'Punto de venta'
}
</script>

<template>
  <div class="ms-page">
    <!-- ===== Topbar: marca + salida ==================================== -->
    <header class="ms-topbar">
      <div class="ms-topbar-inner">
        <div class="ms-brand">
          <img class="ms-logo" src="/logo.png" alt="Crazy Wings" />
          <div class="ms-brand-text">
            <span class="ms-brand-name">Crazy Wings</span>
            <span class="ms-brand-sub">TekLive Rest</span>
          </div>
        </div>
        <button
          type="button"
          class="ms-logout"
          aria-label="Cerrar Sesión"
          title="Cerrar Sesión"
          data-testid="ms-logout"
          @click="logout"
        >
          <LogOut :size="18" aria-hidden="true" />
          <span class="ms-logout-label">Salir</span>
        </button>
      </div>
    </header>

    <!-- ===== Identidad + módulos ======================================== -->
    <main class="ms-main">
      <div class="ms-container">
        <header class="ms-id">
          <span class="ms-avatar" aria-hidden="true">{{ initials }}</span>
          <div class="ms-id-text">
            <p class="ms-greeting">{{ greeting }}</p>
            <h1 class="ms-title">{{ displayName }}</h1>
            <p class="ms-role">{{ headerRoleLabel }}</p>
          </div>
        </header>

        <!-- ===== Hero por rol (solo presentación; carga tolerante) ========= -->
        <section
          v-if="heroVisible && !heroLoading"
          class="ms-hero"
          :class="`ms-hero--${heroVariant}`"
          data-testid="ms-hero"
        >
          <p class="ms-hero-label">
            <span class="ms-hero-dot" aria-hidden="true"></span>
            {{ heroMainLabel }}
          </p>
          <p class="ms-hero-main">
            {{ heroMain ?? '—' }}<span v-if="heroVariant === 'financiero'" class="ms-hero-unit"> MXN</span>
          </p>
          <div class="ms-hero-kpis">
            <div v-for="kpi in heroKpis" :key="kpi.label" class="ms-hero-kpi">
              <b>{{ kpi.value }}</b>
              <span>{{ kpi.label }}</span>
            </div>
          </div>
        </section>

        <div class="ms-section-head">
          <h2 class="ms-section-title">Módulos</h2>
          <span v-if="moduleCount > 0" class="ms-section-count">{{ moduleCount }}</span>
          <span class="ms-section-hint">Toca un módulo para entrar</span>
        </div>

        <div class="ms-grid">
          <!-- Administración: tile claro (firma de la referencia) + badge DIRECTO -->
          <button
            v-if="canAccessAdmin"
            type="button"
            class="ms-card"
            data-testid="ms-card-admin"
            @click="openAdminModule"
          >
            <span class="ms-icon-tile ms-icon-tile--light">
              <ShieldCheck :size="20" aria-hidden="true" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-head">
                <span class="ms-card-title">Administración</span>
                <span class="ms-badge">
                  <span class="ms-badge-dot" aria-hidden="true"></span>DIRECTO
                </span>
              </span>
              <span class="ms-card-subtitle">Catálogo, usuarios, caja y nómina</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="17" aria-hidden="true" />
          </button>

          <!-- Cuentas por Cobrar: gate caja piso 2 → órdenes -->
          <button
            v-if="canAccessPOS"
            type="button"
            class="ms-card"
            data-testid="ms-card-pagos"
            @click="openPaymentsModule"
          >
            <span class="ms-icon-tile">
              <Banknote :size="20" aria-hidden="true" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-head">
                <span class="ms-card-title">Cuentas por Cobrar</span>
              </span>
              <span class="ms-card-subtitle">Cobros pendientes de mesas</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="17" aria-hidden="true" />
          </button>

          <!-- Un card por piso -->
          <template v-if="canAccessPOS && floors.length > 0">
            <button
              v-for="floor in floors"
              :key="floor.floorId"
              type="button"
              class="ms-card"
              :data-testid="`ms-card-floor-${floor.floorId}`"
              @click="openModuleForFloor(floor)"
            >
              <span class="ms-icon-tile">
                <Store :size="20" aria-hidden="true" />
              </span>
              <span class="ms-card-text">
                <span class="ms-card-head">
                  <span class="ms-card-title">{{ floor.name }}</span>
                </span>
                <span class="ms-card-subtitle">{{ floorSubtitle(floor) }}</span>
              </span>
              <ChevronRight class="ms-card-arrow" :size="17" aria-hidden="true" />
            </button>
          </template>

          <!-- Mesero/cocinero sin POS: solo card Piso 2 -->
          <button
            v-if="!canAccessPOS && canAccessFloor"
            type="button"
            class="ms-card"
            data-testid="ms-card-piso2-mesero"
            @click="navigateToRestaurant"
          >
            <span class="ms-icon-tile">
              <UtensilsCrossed :size="20" aria-hidden="true" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-head">
                <span class="ms-card-title">Piso 2</span>
              </span>
              <span class="ms-card-subtitle">Sistema de mesas</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="17" aria-hidden="true" />
          </button>

          <!-- Empty state: sin pisos asignados -->
          <div
            v-if="canAccessPOS && floors.length === 0"
            class="ms-empty"
            data-testid="ms-empty"
          >
            <span class="ms-icon-tile ms-icon-tile--muted">
              <Store :size="24" />
            </span>
            <p>{{ isLoadingFloors ? 'Cargando pisos...' : (floorsStore.error ?? 'No tienes pisos asignados en esta sucursal') }}</p>
            <button
              type="button"
              class="ms-empty-btn"
              :disabled="isLoadingFloors"
              @click="floorsStore.fetchFloors()"
            >
              <RefreshCw :size="16" aria-hidden="true" />
              Recargar pisos
            </button>
          </div>

          <!-- Spinner de carga inicial (cuando aún no hay ni pisos ni error) -->
          <div v-if="canAccessPOS && isLoadingFloors && floors.length === 0" class="ms-loading">
            <AppSpinner :size="24" tone="primary" />
          </div>
        </div>
      </div>
    </main>

    <!-- ===== Footer sin permisos ===== -->
    <footer v-if="!canAccessPOS && !canAccessFloor" class="ms-footer" data-testid="ms-footer">
      No tienes permisos para acceder a ningún módulo
    </footer>

    <!-- ===== Modal Iniciar caja (L113-168) ===== -->
    <StartCashSessionModal
      v-if="cashGateFloor != null"
      :floor-id="cashGateFloor.floorId"
      :title="cashGateTitle"
      @started="onGateStarted"
      @closed="onGateClosed"
    />
  </div>
</template>

<style scoped>
/* ==========================================================================
   Home de módulos · lenguaje premium del hub de Administración
   --------------------------------------------------------------------------
   Misma gramática visual que AdminDashboardView: contenedor de 900px,
   encabezado con avatar + nombre + rol, etiqueta de sección en mayúsculas,
   filas en tarjeta de 16px con tile de icono y chevron.

   Naranja estratégico: SOLO el punto del badge DIRECTO, el foco de teclado y
   el CTA del empty state. La navegación no compite con el acento.
   ========================================================================== */

.ms-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== Topbar: marca + salida ============================================ */
.ms-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-soft);
  padding-top: env(safe-area-inset-top);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

.ms-topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 24px;
}

.ms-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ms-logo {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  object-fit: cover;
  background: var(--elevated);
}

.ms-brand-text {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.ms-brand-name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-brand-sub {
  font-size: 11px;
  line-height: 1.25;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Salida: circular de 44px (objetivo táctil), etiqueta solo con espacio. */
.ms-logout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 44px;
  min-width: 44px;
  padding: 0;
  flex: none;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-2);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.ms-logout:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border);
}

.ms-logout:active {
  background: rgba(255, 255, 255, 0.1);
}

.ms-logout:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.ms-logout-label {
  display: none;
}

/* ===== Contenedor ========================================================
   Full-width (patrón aprobado Ajustes/Caja/Vender): en desktop nada flota
   en una columna 900px con vacíos enormes. El contenido se alinea al borde
   izquierdo y los tiles crecen en columnas según el ancho disponible. */
.ms-main {
  flex: 1;
  display: flex;
  padding: 0 24px max(32px, env(safe-area-inset-bottom));
}

.ms-container {
  width: 100%;
  padding-top: 18px;
}

/* ===== Identidad (avatar + nombre + rol) ================================= */
.ms-id {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px 22px;
  min-width: 0;
}

.ms-avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: var(--elevated);
  border: 1px solid var(--border);
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.ms-id-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ms-greeting {
  margin: 0;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-3);
}

.ms-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.022em;
  line-height: 1.25;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-role {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== Etiqueta de sección =============================================== */
.ms-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
  margin-bottom: 10px;
}

.ms-section-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  color: var(--text-2);
}

.ms-section-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.ms-section-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== Grid de módulos ===================================================
   Móvil: 1 columna (tiles fila sólidos). Desktop: auto-fill — el grid crece
   a 2/3/4 columnas según el ancho real, con mínimo de 260px por tile. */
.ms-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  align-items: start;
}

/* ===== Hero por rol ====================================================== */
.ms-hero {
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 18px;
  background:
    radial-gradient(120% 160% at 85% -20%, rgba(255, 100, 45, 0.2), transparent 55%),
    linear-gradient(180deg, var(--bg-surface-2), #1c1c1c);
  border: 1px solid var(--border);
}

.ms-hero--operativo {
  background:
    radial-gradient(120% 160% at 85% -20%, rgba(63, 185, 80, 0.14), transparent 55%),
    linear-gradient(180deg, var(--bg-surface-2), #1c1c1c);
}

.ms-hero-label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 8px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-3);
}

.ms-hero-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 8px rgba(255, 100, 45, 0.8);
}

.ms-hero--operativo .ms-hero-dot {
  background: var(--success);
  box-shadow: 0 0 8px rgba(63, 185, 80, 0.7);
}

.ms-hero-main {
  margin: 0;
  font-size: 27px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.ms-hero-unit {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text-2);
}

.ms-hero-kpis {
  display: flex;
  gap: 22px;
  margin-top: 11px;
  flex-wrap: wrap;
}

.ms-hero-kpi {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ms-hero-kpi b {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.ms-hero-kpi span {
  font-size: 11px;
  color: var(--text-3);
}

/* ===== Card de módulo ===================================================== */
/* Toda la superficie es el <button>: se conservan los handlers existentes. */
.ms-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 11px 13px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  color: var(--text-1);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

@media (hover: hover) {
  .ms-card:hover {
    background: var(--surface-hover);
    border-color: var(--border);
  }

  .ms-card:hover .ms-card-arrow {
    color: var(--text-1);
    transform: translateX(2px);
  }
}

.ms-card:active {
  background: rgba(255, 255, 255, 0.05);
}

.ms-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-color: transparent;
}

/* ===== Tile de icono ===================================================== */
.ms-icon-tile {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-1);
  transition: background var(--dur) var(--ease);
}

@media (hover: hover) {
  .ms-card:hover .ms-icon-tile {
    background: rgba(255, 255, 255, 0.11);
  }
}

/* Variante clara: la firma visual de la referencia (solo Administración). */
.ms-icon-tile--light {
  background: #f2f2f2;
  border-color: transparent;
  color: #171717;
}

@media (hover: hover) {
  .ms-card:hover .ms-icon-tile--light {
    background: #ffffff;
  }
}

.ms-icon-tile--muted {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.06);
  color: var(--text-3);
}

/* ===== Textos ============================================================ */
.ms-card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ms-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ms-card-title {
  font-size: 14.5px;
  font-weight: 500;
  letter-spacing: -0.012em;
  line-height: 1.3;
  color: var(--text-1);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-card-subtitle {
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--text-2);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-card-arrow {
  flex: none;
  color: var(--text-3);
  transition:
    color var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

/* ===== Badge DIRECTO (en la fila del título, no flotando) ================= */
.ms-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 2px 8px;
  background: var(--primary-soft);
  border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent);
  border-radius: var(--radius-full);
  color: var(--primary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.055em;
  line-height: 1.5;
  text-transform: uppercase;
  white-space: nowrap;
}

.ms-badge-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 999px;
  background: var(--primary);
}

/* ===== Empty state ======================================================= */
.ms-empty {
  grid-column: 1 / -1;
  width: 100%;
  padding: 28px 20px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.ms-empty p {
  margin: 0;
  max-width: 34ch;
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1.45;
}

.ms-empty-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.ms-empty-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.ms-empty-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.ms-empty-btn:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}

.ms-empty-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ms-loading {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

/* ===== Footer sin permisos =============================================== */
.ms-footer {
  padding: 20px 24px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}

/* ==========================================================================
   Tablet / desktop
   ========================================================================== */

/* Dos+ columnas cuando hay ancho real; auto-fit estira los tiles existentes
   a ocupar todo el ancho (sin tracks vacíos a la derecha en ultra-wide). */
@media (min-width: 700px) {
  .ms-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .ms-logout {
    padding: 0 14px;
  }

  .ms-logout-label {
    display: inline;
  }

  /* Tile de módulo más presente en desktop (jerarquía de "panel de comando"). */
  .ms-card {
    min-height: 96px;
    padding: 14px 16px;
    align-items: flex-start;
  }

  .ms-card .ms-icon-tile {
    width: 46px;
    height: 46px;
    border-radius: 14px;
  }

  .ms-card .ms-icon-tile svg {
    width: 22px;
    height: 22px;
  }

  .ms-card-title {
    font-size: 15px;
  }

  .ms-hero {
    padding: 18px;
  }

  .ms-hero-main {
    font-size: 30px;
  }
}

/* Pantallas altas de escritorio: el contenido se queda anclado arriba (como
   Linear/Vercel). Se evita el hueco inferior con un pie de contexto sutil. */
@media (min-width: 700px) {
  .ms-container {
    padding-top: 26px;
  }
}

/* ==========================================================================
   Móvil
   ========================================================================== */

@media (max-width: 699px) {
  .ms-topbar-inner {
    padding: 8px 16px;
  }

  .ms-main {
    padding: 0 16px max(24px, env(safe-area-inset-bottom));
  }

  .ms-container {
    padding-top: 14px;
  }

  .ms-id {
    padding-bottom: 18px;
  }

  .ms-title {
    font-size: 16px;
  }

  .ms-section-hint {
    display: none;
  }

  /* Tile fila sólido en móvil: altura generosa, táctil, "premium". */
  .ms-card {
    min-height: 68px;
    padding: 12px 14px;
    gap: 12px;
    border-radius: 18px;
  }

  .ms-icon-tile {
    width: 44px;
    height: 44px;
    border-radius: 13px;
  }

  .ms-hero {
    padding: 15px;
    margin-bottom: 16px;
  }

  .ms-hero-main {
    font-size: 25px;
  }

  .ms-hero-kpis {
    gap: 18px;
  }
}

/* 360px: se aprieta el padding, NUNCA el objetivo táctil (44px). */
@media (max-width: 380px) {
  .ms-topbar-inner {
    padding-left: 12px;
    padding-right: 12px;
  }

  .ms-main {
    padding-left: 12px;
    padding-right: 12px;
  }

  .ms-brand-sub {
    display: none;
  }

  .ms-card {
    padding: 10px 11px;
    gap: 10px;
  }

  .ms-icon-tile {
    width: 38px;
    height: 38px;
    border-radius: 12px;
  }

  .ms-card-title {
    font-size: 14px;
  }

  .ms-badge {
    padding: 2px 6px;
    letter-spacing: 0.04em;
  }
}

/* ===== Accesibilidad ===================================================== */
@media (prefers-reduced-motion: reduce) {
  .ms-card,
  .ms-icon-tile,
  .ms-card-arrow,
  .ms-logout,
  .ms-empty-btn,
  .ms-hero {
    transition: none;
  }

  .ms-card:hover .ms-card-arrow {
    transform: none;
  }
}
</style>
