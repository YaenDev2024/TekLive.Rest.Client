<script setup lang="ts">
/**
 * ModuleSelectView · selector de módulos — réplica EXACTA de
 * lib/screens/module_selection_screen.dart (CrazyWings, 632 líneas).
 *
 * Estructura replicada:
 * - Header grey[850] con shadow (L203-339): logo 42/50px radius 8 +
 *   'Bienvenido, {nombre}' 18/20 bold + 'Rol: {label}' 13/14 grey[400] +
 *   IconButton logout. Columna en móvil (<600), fila en desktop.
 * - Título 'Selecciona un Módulo' 22/28 bold (L342-349) con espaciadores
 *   24/60 y 24/50 (L340/L350).
 * - Cards en Wrap centrado spacing 16/32 (L357-360): Administración
 *   (highlight #3A2A1F + borde fijo deepOrange + badge 'DIRECTO',
 *   L362-376), Cuentas por Cobrar (L377-389), un card por piso
 *   (L390-408), empty state 'No tienes pisos asignados en esta
 *   sucursal' + botón Recargar pisos (L409-440), card Piso 2 para
 *   mesero/cocinero sin POS (L441-453) y footer sin permisos (L460-470).
 * - _ModuleCard (L478-632): 280x180 (220x160 tablet <1200, full-width
 *   móvil <600, height 140), hover borde deepOrange 2px + glow
 *   deepOrange .3 blur 12, icono grey[300]→deepOrange, título 24/14,
 *   subtítulo 14/11, badge píldora deepOrange (L552-578), modo compact
 *   cuando altura <155.
 *
 * Permisos (L186-195) mapeados a los roles del JWT Rest:
 * - canAccessPOS: admin/cajero/administrador → RestAdmin|SuperAdmin|RestManager|RestCashier
 * - canAccessFloor: admin/cocinero/administrador/mesero → RestAdmin|SuperAdmin|RestManager|RestKitchen|RestWaiter
 * - canAccessAdmin: admin/administrador → RestAdmin|SuperAdmin|RestManager
 *
 * Flujo card piso (réplica _openModuleForFloor/_openPosForFloor L17-79):
 * selectFloor → cashStore.fetchCurrent(floorId) → si hay sesión OPEN
 * navega; si no abre StartCashSessionModal → Iniciar navega / Cancelar no.
 * Piso 2 (restaurante): ejercita el gate y luego toast informativo (la
 * vista de mesas llega en una fase próxima).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Banknote,
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

// --- Header (L172-178) ---------------------------------------------------------

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
  void floorsStore.fetchFloors()
})

const floors = computed(() => floorsStore.floors)
const isLoadingFloors = computed(() => floorsStore.loading)

// --- Layout responsivo (L182-184: <600 móvil, 600-1199 tablet) ------------------

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
function onResize(): void {
  windowWidth.value = window.innerWidth
}
if (typeof window !== 'undefined') window.addEventListener('resize', onResize)

const isMobile = computed(() => windowWidth.value < 600)
const isTablet = computed(() => windowWidth.value >= 600 && windowWidth.value < 1200)

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

/** Card Administración → shell POS actual (equivalente /admin-dashboard). */
function openAdminModule(): void {
  void router.push({ name: 'pos-piso1' })
}

// --- Descripciones de cards (L394-396) ------------------------------------------

function floorSubtitle(floor: RestFloorResponse): string {
  return floorsStore.isRestaurantFloor(floor.floorId) ? 'Sistema de mesas' : 'Punto de venta'
}

// --- Catálogo de iconos (equivalentes lucide de los Icons.* del original) -------
// Icons.admin_panel_settings→ShieldCheck, Icons.payments_outlined→Banknote,
// Icons.store→Store, Icons.restaurant_menu→UtensilsCrossed, Icons.refresh→RefreshCw.
// El icono Restaurant del errorBuilder del logo (L236/299) no aplica en web:
// /logo.png es un asset estático servido por Vite (sin errorBuilder).
const ICONS = {
  admin: ShieldCheck,
  payments: Banknote,
  store: Store,
  restaurantMenu: UtensilsCrossed,
  refresh: RefreshCw,
} as const
</script>

<template>
  <div class="ms-page">
    <!-- ===== Header (L203-339): grey[850] + shadow ===== -->
    <header class="ms-header">
      <div class="ms-header-brand">
        <img class="ms-logo" src="/logo.png" alt="Crazy Wings" />
        <div class="ms-user-meta">
          <span class="ms-user-name">Bienvenido, {{ displayName }}</span>
          <span class="ms-user-role">Rol: {{ headerRoleLabel }}</span>
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
        <LogOut :size="isMobile ? 22 : 26" aria-hidden="true" />
      </button>
    </header>

    <!-- ===== Título (L340-350): espaciadores 24/60 y 24/50 ===== -->
    <h1 class="ms-title" :class="{ 'ms-title--mobile': isMobile }">Selecciona un Módulo</h1>

    <!-- ===== Cards (L352-458): Wrap centrado ===== -->
    <main class="ms-main">
      <div class="ms-cards" :class="{ 'ms-cards--mobile': isMobile }">
        <!-- Administración (L362-376): highlight + badge DIRECTO -->
        <button
          v-if="canAccessAdmin"
          type="button"
          class="ms-card ms-card--highlight"
          :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
          data-testid="ms-card-admin"
          @click="openAdminModule"
        >
          <span class="ms-badge">DIRECTO</span>
          <span class="ms-card-content ms-card-content--badge">
            <component :is="ICONS.admin" class="ms-card-icon" :size="isTablet ? 36 : 56" />
            <span class="ms-card-title" :class="{ 'ms-card-title--compact': isTablet }">Administración</span>
            <span class="ms-card-subtitle" :class="{ 'ms-card-subtitle--compact': isTablet }">Acceso independiente</span>
          </span>
        </button>

        <!-- Cuentas por Cobrar (L377-389): gate caja piso 2 → órdenes -->
        <button
          v-if="canAccessPOS"
          type="button"
          class="ms-card"
          :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
          data-testid="ms-card-pagos"
          @click="openPaymentsModule"
        >
          <span class="ms-card-content">
            <component :is="ICONS.payments" class="ms-card-icon" :size="isTablet ? 36 : 56" />
            <span class="ms-card-title" :class="{ 'ms-card-title--compact': isTablet }">Cuentas por Cobrar</span>
            <span class="ms-card-subtitle" :class="{ 'ms-card-subtitle--compact': isTablet }">Cobros pendientes de mesas</span>
          </span>
        </button>

        <!-- Un card por piso (L390-408) -->
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
            <span class="ms-card-content">
              <component :is="ICONS.store" class="ms-card-icon" :size="isTablet ? 36 : 56" />
              <span class="ms-card-title" :class="{ 'ms-card-title--compact': isTablet }">{{ floor.name }}</span>
              <span class="ms-card-subtitle" :class="{ 'ms-card-subtitle--compact': isTablet }">{{ floorSubtitle(floor) }}</span>
            </span>
          </button>
        </template>

        <!-- Empty state (L409-440): sin pisos asignados -->
        <div
          v-if="canAccessPOS && floors.length === 0"
          class="ms-empty"
          :class="{ 'ms-empty--mobile': isMobile }"
          data-testid="ms-empty"
        >
          <p>{{ isLoadingFloors ? 'Cargando pisos...' : (floorsStore.error ?? 'No tienes pisos asignados en esta sucursal') }}</p>
          <button
            type="button"
            class="ms-empty-btn"
            :disabled="isLoadingFloors"
            @click="floorsStore.fetchFloors()"
          >
            <component :is="ICONS.refresh" :size="18" aria-hidden="true" />
            Recargar pisos
          </button>
        </div>

        <!-- Mesero/cocinero sin POS (L441-453): solo card Piso 2 -->
        <button
          v-if="!canAccessPOS && canAccessFloor"
          type="button"
          class="ms-card"
          :class="{ 'ms-card--mobile': isMobile, 'ms-card--tablet': isTablet }"
          data-testid="ms-card-piso2-mesero"
          @click="navigateToRestaurant"
        >
          <span class="ms-card-content">
            <component :is="ICONS.restaurantMenu" class="ms-card-icon" :size="isTablet ? 36 : 56" />
            <span class="ms-card-title" :class="{ 'ms-card-title--compact': isTablet }">Piso 2</span>
            <span class="ms-card-subtitle" :class="{ 'ms-card-subtitle--compact': isTablet }">Sistema de mesas</span>
          </span>
        </button>

        <!-- Spinner de carga inicial (cuando aún no hay ni pisos ni error) -->
        <div v-if="canAccessPOS && isLoadingFloors && floors.length === 0" class="ms-loading">
          <AppSpinner :size="24" tone="primary" />
        </div>
      </div>
    </main>

    <!-- ===== Footer sin permisos (L460-470) ===== -->
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
/* Réplica Scaffold backgroundColor grey[900] + SafeArea */
.ms-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ===== Header (L203-214): padding 24, grey[850], shadow black .2 blur 8 ===== */
.ms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
  background: var(--bg-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.ms-header-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

/* Logo L284-303: 50x50 radius 8 (42x42 móvil) */
.ms-logo {
  height: 50px;
  width: 50px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}

.ms-user-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 'Bienvenido, {nombre}' L309-315: 20 bold blanco */
.ms-user-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 'Rol: {rol}' L318-324: 14 grey[400] */
.ms-user-role {
  font-size: 14px;
  color: var(--text-muted);
}

/* IconButton logout L329-337: icono blanco 28 */
.ms-logout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
}

.ms-logout:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Título (L342-349): 28 bold blanco ===== */
.ms-title {
  margin: 60px 0 50px;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
}

/* ===== Cards (L352-456): Wrap centrado spacing 32 ===== */
.ms-main {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.ms-cards {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: center;
  gap: 32px;
  width: 100%;
  max-width: 1200px;
  padding: 0 24px;
}

/* ===== _ModuleCard (L505-629) ===== */
.ms-card {
  position: relative;
  display: block;
  width: 280px;
  height: 180px;
  padding: 0;
  background: var(--bg-surface); /* grey[850] L523 */
  border: 1px solid var(--border); /* grey[700] L527 */
  border-radius: 12px;
  cursor: pointer;
  font-family: var(--font);
  text-align: center;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

/* Hover L525-538: borde deepOrange 2px + glow deepOrange .3 blur 12 */
.ms-card:hover {
  border: 2px solid var(--primary);
  box-shadow: 0 4px 12px rgba(255, 87, 34, 0.3);
}

/* Administración (L523): fondo #3A2A1F + borde fijo deepOrange */
.ms-card--highlight {
  background: #3a2a1f;
  border-color: var(--primary);
}

/* Contenido interior (L579-622) */
.ms-card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 14px 14px 12px;
  gap: 0;
}

.ms-card-content--badge {
  padding-top: 36px; /* contentTopPadding con badge L546-548 */
}

/* Icono L589-595: grey[300] → deepOrange al hover */
.ms-card-icon {
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.ms-card:hover .ms-card-icon {
  color: var(--primary);
}

/* Título L597-607: 24 bold grey[300] → blanco al hover */
.ms-card-title {
  margin-top: 12px;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--text-muted);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}

.ms-card:hover .ms-card-title {
  color: var(--text);
}

/* Subtítulo L609-620: 14 grey[500] */
.ms-card-subtitle {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.15;
  color: var(--text-faint);
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Badge píldora (L552-578): deepOrange, radius 999, 11px bold */
.ms-badge {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--primary);
  border-radius: 999px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

/* ===== Empty state (L409-440): Card grey[850] max 420 ===== */
.ms-empty {
  width: 420px;
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.ms-empty p {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton.icon Recargar pisos (L426-435) */
.ms-empty-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.ms-empty-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.ms-empty-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ms-loading {
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

/* ===== Footer (L460-470): grey[400] 14 ===== */
.ms-footer {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

/* ===== Responsivo (L182-184 + L215-277) ===== */

/* Tablet 600-1199: cards 220x160, compact (L371-372 + L542-548) */
@media (min-width: 600px) and (max-width: 1199px) {
  .ms-card {
    width: 220px;
    height: 160px;
  }

  .ms-card--tablet .ms-card-content {
    padding: 10px 10px 8px;
  }

  .ms-card--tablet .ms-card-content--badge {
    padding-top: 28px;
  }

  .ms-card--tablet .ms-card-title {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 700;
  }

  .ms-card--tablet .ms-card-subtitle {
    margin-top: 2px;
    font-size: 11px;
    white-space: nowrap;
    display: block;
  }
}

/* Móvil <600: header columna (L215-277), title 22, cards full-width 140 */
@media (max-width: 599px) {
  .ms-header {
    padding: 16px;
  }

  .ms-logo {
    height: 42px;
    width: 42px;
  }

  .ms-user-name {
    font-size: 18px;
  }

  .ms-user-role {
    font-size: 13px;
  }

  .ms-title {
    margin: 24px 0;
    font-size: 22px;
  }

  .ms-cards {
    gap: 16px;
    padding: 0 16px;
  }

  .ms-card {
    width: 100%;
    height: 140px;
  }

  .ms-empty {
    width: 100%;
  }
}
</style>
