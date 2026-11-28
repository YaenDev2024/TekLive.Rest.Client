<script setup lang="ts">
/**
 * AdminDashboardView · hub de Administración.
 *
 * Origen: réplica de lib/screens/admin/admin_dashboard_home.dart (CrazzyWings) +
 * ModuleCard de lib/screens/home_screen2.dart. Rediseño 2026-11 (pedido del
 * dueño: "esa calidad y nivel de profesionalismo al entrar en Administración").
 *
 * INVARIANTES QUE NO SE TOCAN (solo presentación):
 * - Los 12 tiles, sus labels, rutas (`to`), fases (badge 'Próximamente · Fase N')
 *   y tooltips `title` son EXACTAMENTE los mismos del modelo SECTIONS.
 * - data-testid: `ad-back`, `ad-body`, `ad-tile-<slug>`.
 * - Guard de rol (RestAdmin/SuperAdmin/RestManager) y goBack (canPop ? pop :
 *   replace modules).
 *
 * Lo que cambia es solo la composición visual:
 * - Encabezado tipo dashboard (avatar + nombre + rol + refrescar) en lugar de
 *   topbar plana.
 * - Hero KPI con las ventas del día y barra de mezcla de cobro.
 * - Dos KPIs secundarios (usuarios activos, artículos de catálogo).
 * - Secciones con filas en tarjetas separadas e iconos en tile claro.
 *
 * KPIs: consumen endpoints ya existentes (cash/summary, users/admin/users,
 * catalog/admin/items). Si alguno falla, el número queda en '—' y el hub sigue
 * navegable: la carga nunca bloquea ni rompe la vista.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  ChevronRight,
  DollarSign,
  FileBarChart,
  LayoutGrid,
  Megaphone,
  Package,
  ReceiptText,
  RefreshCw,
  Settings,
  SquarePen,
  Tag,
  TrendingUp,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  type LucideProps,
} from 'lucide-vue-next'
import type { FunctionalComponent } from 'vue'
import { session } from '../../services/auth'
import { getAdminCatalogItems, getAdminUsers, getCashSummary } from '../../api/rest'

const router = useRouter()

// --- Guard de rol (réplica canAccessAdmin de ModuleSelectView) -----------------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void loadKpis()
})

// --- goBack réplica L146-153: canPop ? pop : pushReplacementNamed --------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'modules' })
}

// --- Identidad (solo lectura de la sesión) ------------------------------------

const displayName = computed(() => session.displayName ?? 'Administrador')

const roleLabel = computed(() => {
  switch ((session.role ?? '').toLowerCase()) {
    case 'restadmin':
      return 'Administrador'
    case 'superadmin':
      return 'Superadministrador'
    case 'restmanager':
      return 'Gerente'
    default:
      return 'Administración'
  }
})

const initials = computed(() => {
  const parts = (session.displayName ?? 'A').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
})

// --- KPIs (endpoints existentes, null-tolerantes) -----------------------------

interface KpiState {
  /** Ventas del día (cash/summary.totals.granTotal). */
  sales: number | null
  /** Efectivo del día (para la barra de mezcla de cobro). */
  cash: number | null
  /** Sesiones de caja del día. */
  sessions: number | null
  /** Usuarios activos / totales. */
  activeUsers: number | null
  totalUsers: number | null
  /** Artículos del catálogo. */
  catalogItems: number | null
}

const kpi = reactive<KpiState>({
  sales: null,
  cash: null,
  sessions: null,
  activeUsers: null,
  totalUsers: null,
  catalogItems: null,
})

const kpiLoading = ref(true)

/** HOY en yyyy-MM-dd (fecha de negocio local, igual que AdminSummaryView). */
function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Carga los KPIs en paralelo y de forma tolerante: cualquier fallo deja su
 * valor en null ('—' en pantalla) sin afectar a los demás ni a la navegación.
 */
async function loadKpis(): Promise<void> {
  kpiLoading.value = true
  const [summary, users, items] = await Promise.allSettled([
    getCashSummary({ date: todayIso(), scopeType: 'GLOBAL' }),
    getAdminUsers(false),
    getAdminCatalogItems(),
  ])

  if (summary.status === 'fulfilled') {
    const totals = summary.value.data?.totals
    kpi.sales = totals?.granTotal ?? null
    kpi.cash = totals?.efectivo ?? null
    kpi.sessions = summary.value.data?.sessions?.length ?? null
  }

  if (users.status === 'fulfilled') {
    const list = users.value.data ?? []
    kpi.totalUsers = list.length
    kpi.activeUsers = list.filter((u) => u.isActive).length
  }

  if (items.status === 'fulfilled') {
    const list = items.value.data ?? []
    kpi.catalogItems = list.filter((i) => i.activo).length
  }

  kpiLoading.value = false
}

// --- Formato ------------------------------------------------------------------

/** '—' cuando no hay dato (nunca inventar un 0 que parezca venta real). */
function formatMoney(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatCount(value: number | null): string {
  return value == null ? '—' : String(value)
}

/** Porcentaje de efectivo sobre el total cobrado (0 si no hay datos). */
const cashShare = computed<number>(() => {
  if (kpi.sales == null || kpi.cash == null || kpi.sales <= 0) return 0
  return Math.min(100, Math.round((kpi.cash / kpi.sales) * 100))
})

const heroBarStyle = computed(() => ({ width: `${cashShare.value}%` }))

/** 'de N activos' para la tarjeta de usuarios. */
const usersMeta = computed<string>(() => {
  if (kpi.activeUsers == null || kpi.totalUsers == null) return 'Sin datos'
  return `${kpi.activeUsers} de ${kpi.totalUsers} activos`
})

/** Comparte el porcentaje de activos para la micro-barra de usuarios. */
const usersShare = computed<number>(() => {
  if (kpi.activeUsers == null || kpi.totalUsers == null || kpi.totalUsers <= 0) return 0
  return Math.round((kpi.activeUsers / kpi.totalUsers) * 100)
})

// --- Modelo declarativo (organizedSections L12-139) ----------------------------

interface AdminTile {
  label: string
  icon: FunctionalComponent<LucideProps>
  /** Ruta real cuando el tile ya es navegable; undefined = placeholder. */
  to?: { name: string }
  /** Fase futura del placeholder (badge 'Próximamente · Fase N'). */
  phase?: number
  /** Detalle del tooltip para placeholders. */
  phaseNote?: string
}

interface AdminSection {
  title: string
  icon: FunctionalComponent<LucideProps>
  tiles: AdminTile[]
}

const SECTIONS: AdminSection[] = [
  {
    title: 'Gestión de Productos',
    icon: Package,
    tiles: [
      { label: 'Gestionar Catálogo', icon: Package, to: { name: 'admin-catalogo' } },
      { label: 'Editar Productos', icon: SquarePen, to: { name: 'admin-productos' } },
      { label: 'Catalogo de Categorías', icon: LayoutGrid, to: { name: 'admin-categorias' } },
    ],
  },
  {
    title: 'Promociones y Ofertas',
    icon: Megaphone,
    tiles: [
      { label: 'Crear Promociones', icon: Tag, to: { name: 'admin-promociones' } },
    ],
  },
  {
    title: 'Usuarios',
    icon: Users,
    tiles: [
      { label: 'Crear Usuarios', icon: UserPlus, to: { name: 'admin-usuarios-crear' } },
      { label: 'Gestionar Usuarios', icon: UserCog, to: { name: 'admin-usuarios' } },
    ],
  },
  {
    title: 'Gestión de Caja',
    icon: Wallet,
    tiles: [
      { label: 'Corte de Caja', icon: Wallet, to: { name: 'pos-caja' } },
      { label: 'Resumen de Caja', icon: FileBarChart, to: { name: 'admin-resumen-caja' } },
      { label: 'Crear Nomina', icon: ReceiptText, to: { name: 'admin-nomina' } },
    ],
  },
  {
    title: 'Configuración',
    icon: Settings,
    tiles: [
      { label: 'Configurar Dólar', icon: DollarSign, to: { name: 'pos-ajustes' } },
      { label: 'Aumento de Precios', icon: TrendingUp, to: { name: 'admin-precio-aumento' } },
      { label: 'Asignar Meseros a Mesas', icon: UserCheck, phase: 8, phaseNote: 'Meseros por mesa' },
    ],
  },
]
</script>

<template>
  <div class="ad-page">
    <!-- ===== Encabezado: back + identidad + refrescar ===== -->
    <header class="ad-appbar">
      <button
        type="button"
        class="ad-icon-btn"
        title="Regresar a módulos"
        aria-label="Regresar a módulos"
        data-testid="ad-back"
        @click="goBack"
      >
        <ArrowLeft :size="19" aria-hidden="true" />
      </button>

      <div class="ad-id">
        <span class="ad-avatar" aria-hidden="true">{{ initials }}</span>
        <div class="ad-id-text">
          <p class="ad-greeting">Buen día</p>
          <h1 class="ad-title">{{ displayName }}</h1>
          <p class="ad-role">{{ roleLabel }}</p>
        </div>
      </div>

      <button
        type="button"
        class="ad-icon-btn ad-icon-btn--soft"
        title="Actualizar datos"
        aria-label="Actualizar datos"
        :disabled="kpiLoading"
        @click="loadKpis"
      >
        <RefreshCw :size="18" aria-hidden="true" :class="{ 'ad-spin': kpiLoading }" />
      </button>
    </header>

    <!-- ===== Body ===== -->
    <main class="ad-body" data-testid="ad-body">
      <!-- Hero KPI: ventas del día -->
      <router-link
        :to="{ name: 'admin-resumen-caja' }"
        class="ad-hero"
        title="Ver el resumen de caja del día"
      >
        <div class="ad-hero-top">
          <span class="ad-tile-icon ad-tile-icon--light">
            <Wallet :size="20" aria-hidden="true" />
          </span>
          <span class="ad-hero-label">Ventas de hoy</span>
          <span class="ad-hero-link">Ver detalle</span>
          <ChevronRight :size="15" class="ad-hero-link-arrow" aria-hidden="true" />
        </div>

        <p class="ad-hero-value" :class="{ 'ad-skeleton': kpiLoading }">
          <span class="ad-hero-currency">$</span>{{ kpiLoading ? '0.00' : formatMoney(kpi.sales) }}
        </p>

        <!-- Barra de mezcla de cobro: relleno naranja = efectivo, resto rayado -->
        <div
          class="ad-bar"
          role="img"
          :aria-label="`Efectivo ${cashShare}% del total cobrado`"
        >
          <span class="ad-bar-fill" :style="heroBarStyle" />
        </div>

        <div class="ad-hero-legend">
          <span class="ad-legend-item">
            <span class="ad-legend-dot ad-legend-dot--accent" aria-hidden="true" />
            Efectivo {{ cashShare }}%
          </span>
          <span class="ad-legend-sep" aria-hidden="true">·</span>
          <span class="ad-legend-item">
            {{ kpi.sessions == null ? '—' : kpi.sessions }}
            {{ kpi.sessions === 1 ? 'sesión' : 'sesiones' }}
          </span>
        </div>
      </router-link>

      <!-- KPIs secundarios -->
      <div class="ad-kpis">
        <router-link
          :to="{ name: 'admin-usuarios' }"
          class="ad-kpi"
          title="Gestionar usuarios"
        >
          <div class="ad-kpi-top">
            <span class="ad-tile-icon ad-tile-icon--light ad-tile-icon--sm">
              <Users :size="17" aria-hidden="true" />
            </span>
            <ChevronRight :size="15" class="ad-kpi-arrow" aria-hidden="true" />
          </div>
          <p class="ad-kpi-label">Usuarios</p>
          <p class="ad-kpi-value" :class="{ 'ad-skeleton': kpiLoading }">
            {{ kpiLoading ? '—' : formatCount(kpi.activeUsers) }}
          </p>
          <div class="ad-mini-bar" aria-hidden="true">
            <span class="ad-mini-bar-fill" :style="{ width: `${usersShare}%` }" />
          </div>
          <p class="ad-kpi-meta">{{ kpiLoading ? 'Cargando' : usersMeta }}</p>
        </router-link>

        <router-link
          :to="{ name: 'admin-catalogo' }"
          class="ad-kpi"
          title="Gestionar catálogo"
        >
          <div class="ad-kpi-top">
            <span class="ad-tile-icon ad-tile-icon--light ad-tile-icon--sm">
              <Package :size="17" aria-hidden="true" />
            </span>
            <ChevronRight :size="15" class="ad-kpi-arrow" aria-hidden="true" />
          </div>
          <p class="ad-kpi-label">Artículos</p>
          <p class="ad-kpi-value" :class="{ 'ad-skeleton': kpiLoading }">
            {{ kpiLoading ? '—' : formatCount(kpi.catalogItems) }}
          </p>
          <div class="ad-mini-bar ad-mini-bar--ghost" aria-hidden="true" />
          <p class="ad-kpi-meta">Activos en catálogo</p>
        </router-link>
      </div>

      <!-- ===== Accesos por sección ===== -->
      <section v-for="section in SECTIONS" :key="section.title" class="ad-section">
        <div class="ad-section-header">
          <h2 class="ad-section-title">{{ section.title }}</h2>
          <span class="ad-section-count">{{ section.tiles.length }}</span>
        </div>

        <div class="ad-list">
          <component
            :is="tile.to != null ? 'router-link' : 'button'"
            v-for="tile in section.tiles"
            :key="tile.label"
            :type="tile.to != null ? undefined : 'button'"
            :to="tile.to"
            class="ad-tile"
            :class="{ 'ad-tile--disabled': tile.phase != null }"
            :data-testid="`ad-tile-${tile.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`"
            :title="
              tile.phase != null
                ? `Próximamente (Fase ${tile.phase}): ${tile.phaseNote ?? tile.label}`
                : tile.label === 'Configurar Dólar'
                  ? 'Se abre en Ajustes'
                  : tile.label
            "
          >
            <span class="ad-tile-icon">
              <component :is="tile.icon" :size="18" aria-hidden="true" />
            </span>
            <span class="ad-tile-body">
              <span class="ad-tile-label">{{ tile.label }}</span>
              <span v-if="tile.phase != null" class="ad-tile-badge">
                Próximamente · Fase {{ tile.phase }}
              </span>
            </span>
            <ChevronRight class="ad-tile-arrow" :size="16" aria-hidden="true" />
          </component>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* ==========================================================================
   Administración · dashboard premium (dark / orange estratégico)
   --------------------------------------------------------------------------
   Lenguaje visual: tarjetas grandes con esquinas amplias, tiles de icono
   claros (el acento de la referencia), números muy grandes en tabular, y
   naranja SOLO en la barra de efectivo + el enlace "Ver detalle". No hay
   botón sólido naranja en esta pantalla: el acento no compite con nada.
   ========================================================================== */

.ad-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== Encabezado ======================================================== */

.ad-appbar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: max(20px, env(safe-area-inset-top)) 24px 4px;
}

.ad-icon-btn {
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

.ad-icon-btn:hover:not(:disabled) {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border);
}

.ad-icon-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.ad-icon-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.ad-icon-btn--soft {
  margin-left: auto;
}

/* Identidad: avatar + nombre + rol */
.ad-id {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.ad-avatar {
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

.ad-id-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ad-greeting {
  margin: 0;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-3);
}

.ad-title {
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

.ad-role {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-2);
}

/* ===== Body ============================================================== */

.ad-body {
  flex: 1;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 18px 24px max(36px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== Hero KPI ========================================================== */

.ad-hero {
  display: block;
  padding: 18px 18px 16px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.ad-hero:hover {
  border-color: var(--border);
  background: var(--surface-hover);
}

.ad-hero-top {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 14px;
}

.ad-hero-label {
  font-size: 14.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.ad-hero-link {
  margin-left: auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
}

.ad-hero-link-arrow {
  flex: none;
  color: var(--primary);
}

.ad-hero-value {
  margin: 0 0 15px;
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: clamp(30px, 9vw, 42px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.ad-hero-currency {
  font-size: 0.58em;
  font-weight: 600;
  color: var(--text-2);
  letter-spacing: -0.01em;
}

/* Barra: relleno naranja (efectivo) + track rayado (resto) */
.ad-bar {
  position: relative;
  height: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.045);
  overflow: hidden;
}

.ad-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: repeating-linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.075) 0 5px,
    transparent 5px 10px
  );
  pointer-events: none;
}

.ad-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
  border-radius: 999px;
  background: var(--primary);
  transition: width var(--dur-slow) var(--ease);
}

.ad-hero-legend {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 11px;
  font-size: 12.5px;
  color: var(--text-2);
}

.ad-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ad-legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--primary);
}

.ad-legend-sep {
  color: var(--text-3);
}

/* ===== KPIs secundarios ================================================== */

.ad-kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ad-kpi {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 15px 15px 14px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.ad-kpi:hover {
  border-color: var(--border);
  background: var(--surface-hover);
}

.ad-kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ad-kpi-arrow {
  flex: none;
  color: var(--text-3);
}

.ad-kpi-label {
  margin: 0 0 6px;
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.ad-kpi-value {
  margin: 0 0 10px;
  font-size: clamp(24px, 7vw, 29px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.ad-mini-bar {
  height: 5px;
  margin-bottom: 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

/* Micro-barra neutra: el naranja ya está en el hero, no se repite aquí. */
.ad-mini-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  transition: width var(--dur-slow) var(--ease);
}

.ad-mini-bar--ghost {
  background: repeating-linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.09) 0 4px,
    transparent 4px 8px
  );
}

.ad-kpi-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
}

/* ===== Secciones ========================================================= */

.ad-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin-top: 14px;
}

.ad-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}

.ad-section-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  color: var(--text-2);
}

.ad-section-count {
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

/* Lista: tarjetas separadas (no un bloque con divisores) */
.ad-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ad-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  color: var(--text-1);
  font-family: var(--font);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

@media (hover: hover) {
  .ad-tile:hover {
    background: var(--surface-hover);
    border-color: var(--border);
  }

  .ad-tile:hover .ad-tile-arrow {
    color: var(--text-1);
    transform: translateX(2px);
  }
}

.ad-tile:active {
  background: rgba(255, 255, 255, 0.05);
}

/* Tile de icono claro: la firma visual de la referencia */
.ad-tile-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-1);
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

/* Variante clara — solo en los KPI (acento de la referencia). */
.ad-tile-icon--light {
  background: #f2f2f2;
  border-color: transparent;
  color: #171717;
}

.ad-tile-icon--sm {
  width: 34px;
  height: 34px;
  border-radius: 11px;
}

.ad-tile-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ad-tile-label {
  font-size: 14.5px;
  font-weight: 500;
  letter-spacing: -0.012em;
  line-height: 1.3;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
}

.ad-tile-badge {
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-3);
}

.ad-tile-arrow {
  flex: none;
  color: var(--text-3);
  transition:
    color var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

/* Placeholder de fase futura: legible pero no accionable */
.ad-tile--disabled {
  cursor: default;
  opacity: 0.5;
}

.ad-tile--disabled .ad-tile-icon {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-soft);
  color: var(--text-3);
}

.ad-tile--disabled:hover {
  background: var(--card);
  border-color: var(--border-soft);
}

/* ===== Carga ============================================================= */

.ad-skeleton {
  color: var(--text-3) !important;
  opacity: 0.65;
}

.ad-spin {
  animation: ad-spin 0.9s linear infinite;
}

@keyframes ad-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ad-spin {
    animation: none;
  }

  .ad-bar-fill,
  .ad-mini-bar-fill,
  .ad-tile-arrow {
    transition: none;
  }
}

/* ===== Tablet / móvil ==================================================== */

@media (max-width: 899px) {
  .ad-body,
  .ad-appbar {
    max-width: 100%;
  }
}

@media (max-width: 699px) {
  .ad-appbar {
    padding: max(14px, env(safe-area-inset-top)) 16px 2px;
    gap: 10px;
  }

  .ad-body {
    padding: 14px 16px max(28px, env(safe-area-inset-bottom));
  }

  .ad-hero {
    padding: 16px 15px 14px;
    border-radius: 18px;
  }

  .ad-kpi {
    padding: 13px 13px 12px;
    border-radius: 16px;
  }

  .ad-kpi-label {
    font-size: 13px;
  }

  .ad-tile {
    min-height: 58px;
    padding: 9px 12px;
    gap: 11px;
    border-radius: 14px;
  }

  .ad-tile-icon {
    width: 38px;
    height: 38px;
    border-radius: 12px;
  }

  .ad-tile-label {
    font-size: 14px;
  }
}

@media (max-width: 380px) {
  .ad-appbar {
    padding-left: 12px;
    padding-right: 12px;
  }

  .ad-body {
    padding-left: 12px;
    padding-right: 12px;
  }

  /* El avatar sí puede encoger; los botones NO: el objetivo táctil de 44px
     es innegociable, incluso a 360px. */
  .ad-avatar {
    width: 40px;
    height: 40px;
  }

  .ad-title {
    font-size: 16px;
  }

  .ad-kpi-value {
    font-size: 24px;
  }

  .ad-tile-icon {
    width: 36px;
    height: 36px;
  }
}
</style>
