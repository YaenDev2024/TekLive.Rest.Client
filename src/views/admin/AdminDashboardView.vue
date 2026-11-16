<script setup lang="ts">
/**
 * AdminDashboardView · hub de Administración — réplica EXACTA de
 * lib/screens/admin/admin_dashboard_home.dart (CrazyWings) + ModuleCard de
 * lib/screens/home_screen2.dart L51-87.
 *
 * Estructura replicada:
 * - Scaffold bg grey[900] (L141: Theme.scaffoldBackgroundColor → var(--bg)
 *   #212121). STANDALONE full-screen FUERA del PosShell: sin rail (el
 *   original es una ruta raíz propia, no un hijo del layout del POS).
 * - AppBar réplica (L142-158): back arrow (tooltip 'Regresar a módulos') +
 *   título 'Administración', bg = scaffoldBackgroundColor, elevation 0 (sin
 *   sombra). goBack réplica L146-153: canPop ? pop : pushReplacementNamed
 *   → si window.history.state?.back existe router.back(), si no
 *   router.replace({ name: 'modules' }).
 * - Body ListView padding 24 (L159-160) con 5 secciones en el ORDEN EXACTO
 *   de L12-139 (organizedSections):
 *     1. 'Gestión de Productos'  (Icons.inventory_2_outlined → Package)
 *     2. 'Promociones y Ofertas' (Icons.campaign_outlined    → Megaphone)
 *     3. 'Usuarios'              (Icons.group_outlined       → Users)
 *     4. 'Gestión de Caja'       (Icons.point_of_sale_outlined → Wallet)
 *     5. 'Configuración'         (Icons.settings_outlined    → Settings)
 * - Section header réplica L171-191: icono 22px colorScheme.primary
 *   (deepOrange → var(--primary)) + gap 10 + título 20 bold white70
 *   (rgba(255,255,255,0.7)), padding vertical 16 / horizontal 8. Gap 24
 *   entre secciones (SizedBox L209).
 * - Grid réplica L195-203: SliverGridDelegateWithMaxCrossAxisExtent 250 /
 *   crossAxisSpacing 16 / mainAxisSpacing 16 / childAspectRatio 1.2.
 *   DESVIACIÓN MENOR #1 documentada: CSS no tiene un equivalente exacto de
 *   maxCrossAxisExtent, se usa `repeat(auto-fill, minmax(220px, 1fr))` con
 *   gap 16 y cada tile `aspect-ratio: 1.2` (mismo ratio; 220px ≈ la cota
 *   superior de 250 menos gap, produce el mismo acomodo de columnas en los
 *   anchos de escritorio objetivo).
 * - Tile = ModuleCard réplica home_screen2.dart L51-87: Card con color
 *   heredado del CardTheme global (grey[850]→ #303030 en este proyecto; el
 *   campo `color` de AppModule es CÓDIGO MUERTO — L20/28/36/50/64/72/86/94/
 *   102/116/124/132 — así que TODOS los tiles son uniformes #303030, no se
 *   pintan por-tile), radius 12 (L65), elevation 2 del CardTheme (box-shadow
 *   sutil), InkWell estándar (hover elevation 4 sutil, SIN hover deepOrange),
 *   contenido centrado: icono 48px colorScheme.primary + SizedBox 16 +
 *   nombreItem bold centrado (titleMedium→16px). Tile activo = router-link/
 *   button real; tile deshabilitado: opacity 0.45, cursor default, badge
 *   'Próximamente · Fase N' bajo el título + title/tooltip con detalle.
 * - DESVIACIÓN CONSCIENTE #2 (iconos lucide): el original mapea iconos por
 *   string ('CatalogManage'→Package, 'ProductEdit'→SquarePen,
 *   'CategoryCatalog'→LayoutGrid, 'PromoCreate'→Tag, 'UserCreate'→UserPlus,
 *   'UserManage'→UserCog, 'CashCut'→Wallet, 'CashSummary'→FileBarChart,
 *   'PayrollCreate'→ReceiptText, 'DollarConfig'→DollarSign,
 *   'PriceIncrease'→TrendingUp) y tiene un BUG en 'WaiterAssign' (el icono
 *   no existe en su mapa → se renderiza '?'): aquí se usa UserCheck como
 *   equivalente semántico de asignar meseros, corrigiendo el bug.
 *
 * Guard de rol (mismo patrón canAccessAdmin de ModuleSelectView.vue L80-82):
 * si session.role (lowercase) no está en ['restadmin','superadmin',
 * 'restmanager'] → router.replace({ name: 'modules' }).
 *
 * Mapa tile → fase futura (placeholders con badge 'Próximamente · Fase N'):
 * - Fase 6:  Gestionar Catálogo (REAL desde Fase 6.1 → admin-catalogo),
 *            Editar Productos, Catalogo de Categorías (CRUD catálogo)
 * - Fase 7:  Crear Usuarios, Gestionar Usuarios (REALES desde Fase 7 →
 *            admin-usuarios-crear / admin-usuarios)
 * - Fase 8:  Asignar Meseros a Mesas
 * - Fase 9:  Crear Promociones (REAL desde Fase admin → admin-promociones),
 *            Configurar Dólar dedicado, Aumento de Precios (REAL desde
 *            Fase admin → admin-precio-aumento)
 * - Fase 10: Crear Nomina (REAL desde Fase admin → admin-nomina),
 *            Resumen de Caja (REAL desde Fase admin → admin-resumen-caja)
 * Tiles REALES ya navegables: Corte de Caja → { name: 'pos-caja' } (la
 * CashDrawerView réplica ya existe) y Configurar Dólar → { name:
 * 'pos-ajustes' } (el modal dólar ya vive ahí; tooltip 'Se abre en Ajustes').
 */
import { onMounted } from 'vue'
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

const router = useRouter()

// --- Guard de rol (réplica canAccessAdmin de ModuleSelectView) -----------------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
  }
})

// --- goBack réplica L146-153: canPop ? pop : pushReplacementNamed --------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'modules' })
}

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
      // Fase admin M1: tile real — CRUD de promociones (create_promo.dart).
      { label: 'Crear Promociones', icon: Tag, to: { name: 'admin-promociones' } },
    ],
  },
  {
    title: 'Usuarios',
    icon: Users,
    tiles: [
      // Fase 7: tiles reales — alta y administración de usuarios Rest.
      { label: 'Crear Usuarios', icon: UserPlus, to: { name: 'admin-usuarios-crear' } },
      { label: 'Gestionar Usuarios', icon: UserCog, to: { name: 'admin-usuarios' } },
    ],
  },
  {
    title: 'Gestión de Caja',
    icon: Wallet,
    tiles: [
      // Tile real: la CashDrawerView réplica ya existe bajo el shell POS.
      { label: 'Corte de Caja', icon: Wallet, to: { name: 'pos-caja' } },
      // Fase admin M3+M4: tiles reales — resumen y nómina (réplicas .dart).
      { label: 'Resumen de Caja', icon: FileBarChart, to: { name: 'admin-resumen-caja' } },
      { label: 'Crear Nomina', icon: ReceiptText, to: { name: 'admin-nomina' } },
    ],
  },
  {
    title: 'Configuración',
    icon: Settings,
    tiles: [
      // Tile real: el modal dólar ya vive en Ajustes (réplica settings.dart).
      { label: 'Configurar Dólar', icon: DollarSign, to: { name: 'pos-ajustes' } },
      // Fase admin M2: tile real — upsert de aumento por alcance.
      { label: 'Aumento de Precios', icon: TrendingUp, to: { name: 'admin-precio-aumento' } },
      { label: 'Asignar Meseros a Mesas', icon: UserCheck, phase: 8, phaseNote: 'Meseros por mesa' },
    ],
  },
]
</script>

<template>
  <div class="ad-page">
    <!-- ===== Topbar: back + título + contexto ===== -->
    <header class="ad-appbar">
      <button
        type="button"
        class="ad-back"
        title="Regresar a módulos"
        aria-label="Regresar a módulos"
        data-testid="ad-back"
        @click="goBack"
      >
        <ArrowLeft :size="18" aria-hidden="true" />
      </button>
      <div class="ad-appbar-text">
        <h1 class="ad-title">Administración</h1>
        <p class="ad-subtitle">Configura el sistema y administra el negocio</p>
      </div>
    </header>

    <!-- ===== Body ===== -->
    <main class="ad-body" data-testid="ad-body">
      <section v-for="section in SECTIONS" :key="section.title" class="ad-section">
        <!-- Section header -->
        <div class="ad-section-header">
          <component :is="section.icon" :size="15" class="ad-section-icon" aria-hidden="true" />
          <h2 class="ad-section-title">{{ section.title }}</h2>
          <span class="ad-section-count">{{ section.tiles.length }}</span>
        </div>

        <!-- Lista de acciones (filas, no cuadrados grises) -->
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
   Administración · hub de acciones (Premium Minimalist / Orange)
   --------------------------------------------------------------------------
   Composición: topbar ligera (back + título + subtítulo) y, por sección, una
   lista agrupada de filas (icono · label · chevron) en lugar de la retícula
   de cuadrados grises. Se conservan TODOS los tiles, rutas, testids
   (ad-tile-*), el badge de fase y los tooltips `title`.
   ========================================================================== */

.ad-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== Topbar ============================================================ */
.ad-appbar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  padding: 18px 24px 10px;
}

.ad-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text-2);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.ad-back:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
  border-color: var(--border-soft);
}

.ad-back:active {
  background: rgba(255, 255, 255, 0.1);
}

.ad-appbar-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ad-title {
  margin: 0;
  font-size: var(--text-h1);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--text-1);
}

.ad-subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-3);
}

/* ===== Body ============================================================== */
.ad-body {
  flex: 1;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  padding: 8px 24px max(32px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 26px;
}

/* ===== Sección =========================================================== */
.ad-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.ad-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.ad-section-icon {
  flex: none;
  color: var(--text-3);
}

.ad-section-title {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.ad-section-count {
  margin-left: auto;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* ===== Lista agrupada de acciones ======================================== */
.ad-list {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* Fila: tile de icono + label (+badge) + chevron */
.ad-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 58px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-1);
  font-family: var(--font);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.ad-tile:last-child {
  border-bottom: none;
}

@media (hover: hover) {
  .ad-tile:hover {
    background: var(--surface-hover);
  }

  .ad-tile:hover .ad-tile-icon {
    background: var(--primary);
    border-color: var(--primary);
    color: #ffffff;
  }

  .ad-tile:hover .ad-tile-arrow {
    color: var(--text-1);
    transform: translateX(2px);
  }
}

.ad-tile:active {
  background: rgba(255, 255, 255, 0.05);
}

/* Tile de icono: 34px con tinte de acento sutil (no cuadrado gris) */
.ad-tile-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  border: 1px solid color-mix(in srgb, var(--primary) 22%, transparent);
  color: var(--primary);
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.ad-tile-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ad-tile-label {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
}

.ad-tile-badge {
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-3);
}

.ad-tile-arrow {
  flex: none;
  color: var(--text-3);
  opacity: 0.7;
  transition:
    color var(--dur) var(--ease),
    transform var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}

/* Placeholder de fase futura: legible pero no accionable */
.ad-tile--disabled {
  cursor: default;
  opacity: 0.55;
}

.ad-tile--disabled .ad-tile-icon {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-soft);
  color: var(--text-3);
}

.ad-tile--disabled:hover {
  background: transparent;
}

/* ===== Tablet / móvil ==================================================== */
@media (max-width: 899px) {
  .ad-body {
    max-width: 100%;
    padding: 4px 20px max(28px, env(safe-area-inset-bottom));
  }
}

@media (max-width: 699px) {
  .ad-appbar {
    padding: 14px 16px 6px;
  }

  .ad-title {
    font-size: 20px;
  }

  .ad-subtitle {
    font-size: var(--text-xs);
  }

  .ad-body {
    padding: 4px 16px max(24px, env(safe-area-inset-bottom));
    gap: 22px;
  }

  /* Filas con área táctil cómoda y chevron siempre visible */
  .ad-tile {
    min-height: 60px;
    gap: 12px;
    padding: 12px;
  }

  .ad-tile-arrow {
    opacity: 1;
  }

  .ad-tile-label {
    font-size: 14.5px;
  }
}

@media (max-width: 380px) {
  .ad-tile {
    gap: 10px;
    padding: 12px 10px;
  }

  .ad-tile-icon {
    width: 32px;
    height: 32px;
  }
}
</style>
