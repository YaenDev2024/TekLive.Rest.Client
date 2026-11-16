<script setup lang="ts">
/**
 * ModuleSelectView · selector de módulos.
 *
 * LÓGICA: réplica fiel de lib/screens/module_selection_screen.dart
 * (CrazyWings) — permisos, gate de caja por piso y navegación intactos.
 *
 * PRESENTACIÓN: rediseño visual 2026-11-16 (rama ui-exp, experimento local) —
 * estética SaaS empresarial sobre la identidad dark + deepOrange:
 * - Topbar slim sticky (logo + usuario + ghost logout) con borde inferior
 *   sutil en vez de sombra pesada; safe-area respetada.
 * - Intro con título + subtítulo alineados al grid (jerarquía SaaS).
 * - Grid fluido auto-fill (desktop/tablet) que aprovecha el ancho sin
 *   huecos; móvil = filas horizontales full-width (look app nativa).
 * - Cards: icon-tile redondeado (accent al 12%), títulos left-aligned,
 *   hover con lift sutil + icon-tile que pasa a sólido, arrow chevron,
 *   focus-visible, :active presión, reduced-motion.
 * - Badge DIRECTO con punto indicador en la esquina superior derecha.
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
import { useFloorsStore } from '../../stores/floors'
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

onMounted(() => {
  syncLayoutFlags()
  void floorsStore.fetchFloors()
})

const floors = computed(() => floorsStore.floors)
const isLoadingFloors = computed(() => floorsStore.loading)

// --- Layout responsivo -----------------------------------------------------------
// Los breakpoints viven SOLO en CSS (@media): sin listener de resize (el
// anterior tenía leak). Las clases isMobile/isTablet se escriben una vez al
// montar como hooks semánticos (SSR-safe); el CSS es la fuente de verdad.

const isMobile = ref(false)
const isTablet = ref(false)

function syncLayoutFlags(): void {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 600
  isTablet.value = window.innerWidth >= 600 && window.innerWidth < 1200
}
syncLayoutFlags()

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
    <!-- ===== Topbar slim: logo + usuario + logout ====================== -->
    <header class="ms-topbar">
      <div class="ms-brand">
        <img class="ms-logo" src="/logo.png" alt="Crazy Wings" />
        <div class="ms-user-meta">
          <span class="ms-user-name">{{ displayName }}</span>
          <span class="ms-user-role">{{ headerRoleLabel }}</span>
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
        <LogOut :size="isMobile ? 18 : 20" aria-hidden="true" />
        <span class="ms-logout-label">Salir</span>
      </button>
    </header>

    <!-- ===== Intro + Grid de módulos ==================================== -->
    <main class="ms-main">
      <div class="ms-container">
        <header class="ms-intro">
          <h1 class="ms-title">Selecciona un módulo</h1>
          <p class="ms-subtitle">Elige el área de trabajo para continuar</p>
        </header>

        <div class="ms-grid">
          <!-- Administración: highlight + badge DIRECTO -->
          <button
            v-if="canAccessAdmin"
            type="button"
            class="ms-card ms-card--highlight"
            :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
            data-testid="ms-card-admin"
            @click="openAdminModule"
          >
            <span class="ms-badge"><span class="ms-badge-dot" aria-hidden="true"></span>DIRECTO</span>
            <span class="ms-icon-tile ms-icon-tile--solid">
              <ShieldCheck :size="26" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-title">Administración</span>
              <span class="ms-card-subtitle">Acceso independiente</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="18" aria-hidden="true" />
          </button>

          <!-- Cuentas por Cobrar: gate caja piso 2 → órdenes -->
          <button
            v-if="canAccessPOS"
            type="button"
            class="ms-card"
            :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
            data-testid="ms-card-pagos"
            @click="openPaymentsModule"
          >
            <span class="ms-icon-tile">
              <Banknote :size="26" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-title">Cuentas por Cobrar</span>
              <span class="ms-card-subtitle">Cobros pendientes de mesas</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="18" aria-hidden="true" />
          </button>

          <!-- Un card por piso -->
          <template v-if="canAccessPOS && floors.length > 0">
            <button
              v-for="floor in floors"
              :key="floor.floorId"
              type="button"
              class="ms-card"
              :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
              :data-testid="`ms-card-floor-${floor.floorId}`"
              @click="openModuleForFloor(floor)"
            >
              <span class="ms-icon-tile">
                <Store :size="26" />
              </span>
              <span class="ms-card-text">
                <span class="ms-card-title">{{ floor.name }}</span>
                <span class="ms-card-subtitle">{{ floorSubtitle(floor) }}</span>
              </span>
              <ChevronRight class="ms-card-arrow" :size="18" aria-hidden="true" />
            </button>
          </template>

          <!-- Mesero/cocinero sin POS: solo card Piso 2 -->
          <button
            v-if="!canAccessPOS && canAccessFloor"
            type="button"
            class="ms-card"
            :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
            data-testid="ms-card-piso2-mesero"
            @click="navigateToRestaurant"
          >
            <span class="ms-icon-tile">
              <UtensilsCrossed :size="26" />
            </span>
            <span class="ms-card-text">
              <span class="ms-card-title">Piso 2</span>
              <span class="ms-card-subtitle">Sistema de mesas</span>
            </span>
            <ChevronRight class="ms-card-arrow" :size="18" aria-hidden="true" />
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
   Rediseño 2026-11-16 · SaaS dark + deepOrange (identidad CrazyWings)
   Tokens locales de la vista (derivados del design system global):
   ========================================================================== */

.ms-page {
  --ms-tile-bg: var(--primary-soft);
  --ms-card-hover-shadow: var(--shadow-md);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ===== Topbar slim sticky ================================================ */
.ms-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 24px;
  padding-top: max(10px, env(safe-area-inset-top));
  padding-left: max(24px, env(safe-area-inset-left));
  padding-right: max(24px, env(safe-area-inset-right));
  background: var(--bg-surface);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-soft);
}

.ms-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ms-logo {
  height: 36px;
  width: 36px;
  flex: none;
  border-radius: 9px;
  object-fit: cover;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.ms-user-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ms-user-name {
  font-size: var(--text-body);
  font-weight: 600;
  letter-spacing: -0.012em;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-user-role {
  font-size: var(--text-xs);
  color: var(--text-3);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Logout ghost ultra-ligero: sin borde; fondo sutil solo al hover. */
.ms-logout {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  flex: none;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-2);
  font-family: var(--font);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.ms-logout:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
}

.ms-logout:active {
  background: rgba(255, 255, 255, 0.11);
  transform: scale(0.98);
}

.ms-logout:active {
  transform: scale(0.97);
}

.ms-logout-label {
  display: none;
}

/* ===== Intro + contenedor ================================================ */
.ms-main {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 0 24px 32px;
}

.ms-container {
  width: 100%;
  max-width: 1200px;
  padding-top: 48px;
}

.ms-intro {
  margin-bottom: 24px;
}

.ms-title {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--text-1);
}

.ms-subtitle {
  margin: 7px 0 0;
  font-size: var(--text-body);
  color: var(--text-2);
}

/* ===== Grid fluido (desktop: auto-fill, aprovecha el ancho sin huecos) ==== */
.ms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

/* ===== Card de módulo ===================================================== */
/* El card completo es un <button>: TODA la superficie es interactiva y
   conserva los eventos existentes (navigate/gate). */
.ms-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-height: 152px;
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-family: var(--font);
  text-align: left;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

/* Hover/active con puntero real (evita sticky-hover en táctil). */
@media (hover: hover) {
  /* Lift sutil + borde acentuado + sombra discreta. Sin saltos de layout:
     todo crece hacia afuera (shadow) sin mover el contenido. */
  .ms-card:hover {
    border-color: color-mix(in srgb, var(--primary) 50%, var(--border-soft));
    background: var(--surface-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .ms-card:hover .ms-icon-tile {
    background: var(--primary);
    color: #ffffff;
  }

  .ms-card:hover .ms-card-arrow {
    opacity: 1;
    transform: translateX(0);
    color: var(--primary);
  }
}

/* Presión táctil/click: hundimiento leve + borde acento. */
.ms-card:active {
  transform: translateY(0) scale(0.985);
  border-color: color-mix(in srgb, var(--primary) 60%, var(--border-soft));
}

/* Teclado: anillo de foco nítido (refuerza el global). */
.ms-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-color: color-mix(in srgb, var(--primary) 65%, var(--border-soft));
}

/* Administración: identidad destacada (tinte de acento sutil, sin gradiente). */
.ms-card--highlight {
  background: var(--primary-subtle);
  border-color: color-mix(in srgb, var(--primary) 38%, transparent);
}

.ms-card--highlight:hover {
  background: color-mix(in srgb, var(--primary) 26%, #272727);
  border-color: color-mix(in srgb, var(--primary) 65%, transparent);
}

/* ===== Icon tile (contenedor del icono, look SaaS) ======================== */
.ms-icon-tile {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: var(--radius-md);
  background: var(--ms-tile-bg);
  color: var(--primary);
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.ms-icon-tile--solid {
  background: var(--primary);
  color: #ffffff;
}

.ms-icon-tile--muted {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

/* ===== Textos de la card (wrapper columna: título sobre subtítulo) ======== */
.ms-card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  margin-top: auto; /* empuja el bloque de textos al fondo en desktop */
}

.ms-card-title {
  font-size: var(--text-h2);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
  color: var(--text-1);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-card-subtitle {
  font-size: var(--text-sm);
  line-height: 1.35;
  color: var(--text-2);
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Chevron: aparece al hover (desktop, @media hover) / fijo tenue (táctil). */
.ms-card-arrow {
  position: absolute;
  right: 14px;
  bottom: 14px;
  color: var(--text-faint);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.2s cubic-bezier(0.2, 0.6, 0.2, 1),
    transform 0.2s cubic-bezier(0.2, 0.6, 0.2, 1),
    color 0.2s cubic-bezier(0.2, 0.6, 0.2, 1);
}

/* ===== Badge DIRECTO ======================================================= */
.ms-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  background: var(--primary-soft);
  border: 1px solid color-mix(in srgb, var(--primary) 32%, transparent);
  border-radius: var(--radius-full);
  color: var(--primary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
}

.ms-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--primary);
}

/* ===== Empty state ========================================================== */
.ms-empty {
  grid-column: 1 / -1;
  width: 100%;
  max-width: 460px;
  margin: 24px auto 0;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.ms-empty p {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-body);
}

.ms-empty-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.ms-empty-btn:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: var(--shadow-accent);
}

.ms-empty-btn:active:not(:disabled) {
  transform: scale(0.97);
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

/* ===== Footer sin permisos =================================================== */
.ms-footer {
  padding: 24px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  text-align: center;
  color: var(--text-3);
  font-size: var(--text-sm);
}

/* ==========================================================================
   Responsivo
   ========================================================================== */

/* Laptop chico (1366): intro algo más compacta. */
@media (max-width: 1439px) {
  .ms-container {
    padding-top: 32px;
  }
}

/* Tablet 600-1199: 2 columnas fijas. */
@media (min-width: 600px) and (max-width: 1199px) {
  .ms-container {
    padding-top: 32px;
  }

  .ms-title {
    font-size: var(--text-h1);
  }

  .ms-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .ms-card {
    min-height: 144px;
    padding: 16px;
  }

  .ms-icon-tile {
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
  }

  .ms-card-title {
    font-size: 17px;
  }

  .ms-card-subtitle {
    font-size: 12.5px;
  }

  .ms-badge {
    top: 12px;
    right: 12px;
  }
}

/* Móvil <600: filas horizontales full-width (look app nativa). */
@media (max-width: 599px) {
  .ms-topbar {
    padding: 10px 16px;
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }

  .ms-logo {
    height: 36px;
    width: 36px;
  }

  .ms-user-name {
    font-size: 14px;
  }

  .ms-user-role {
    font-size: 12px;
  }

  .ms-logout {
    width: 38px;
    padding: 0;
    justify-content: center;
  }

  .ms-main {
    padding: 0 16px 24px;
  }

  .ms-container {
    padding-top: 22px;
  }

  .ms-intro {
    margin-bottom: 18px;
  }

  .ms-title {
    font-size: 22px;
  }

  .ms-subtitle {
    font-size: var(--text-sm);
  }

  .ms-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  /* Fila: icon-tile izquierda, textos centro, chevron derecha. */
  .ms-card {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-height: 72px;
    padding: 12px 14px;
    border-radius: 14px;
  }

  .ms-card:hover {
    transform: none; /* sin lift en táctil */
  }

  .ms-icon-tile {
    width: 44px;
    height: 44px;
    border-radius: 12px;
  }

  .ms-card-title {
    margin-top: 0;
    font-size: 15.5px;
  }

  .ms-card-subtitle {
    font-size: 12.5px;
    -webkit-line-clamp: 1;
  }
  .ms-card-text {
    margin-top: 0;
    flex: 1;
    min-width: 0; /* permite que título/subtítulo trunquen con ellipsis */
  }

  .ms-card-arrow {
    position: static;
    margin-left: auto;
    opacity: 1;
    transform: none;
    color: var(--text-faint);
  }

  .ms-badge {
    top: -7px;
    right: 10px;
    font-size: 10px;
    padding: 3px 8px;
  }
}

/* ===== Accesibilidad ========================================================= */
@media (prefers-reduced-motion: reduce) {
  .ms-card,
  .ms-icon-tile,
  .ms-card-arrow,
  .ms-logout,
  .ms-empty-btn {
    transition: none;
  }

  .ms-card:hover {
    transform: none;
  }

  .ms-card:active {
    transform: none;
  }
}

/* Label "Salir" solo con espacio suficiente (desktop/Tauri). */
@media (min-width: 720px) {
  .ms-logout-label {
    display: inline;
  }
}
</style>
