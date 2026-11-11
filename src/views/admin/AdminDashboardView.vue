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
 * - Fase 7:  Crear Usuarios, Gestionar Usuarios
 * - Fase 8:  Asignar Meseros a Mesas
 * - Fase 9:  Crear Promociones, Configurar Dólar dedicado, Aumento de Precios
 * - Fase 10: Crear Nomina, Resumen de Caja
 * Tiles REALES ya navegables: Corte de Caja → { name: 'pos-caja' } (la
 * CashDrawerView réplica ya existe) y Configurar Dólar → { name:
 * 'pos-ajustes' } (el modal dólar ya vive ahí; tooltip 'Se abre en Ajustes').
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
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
      { label: 'Crear Promociones', icon: Tag, phase: 9, phaseNote: 'Promociones y ofertas' },
    ],
  },
  {
    title: 'Usuarios',
    icon: Users,
    tiles: [
      { label: 'Crear Usuarios', icon: UserPlus, phase: 7, phaseNote: 'Alta de usuarios' },
      { label: 'Gestionar Usuarios', icon: UserCog, phase: 7, phaseNote: 'Administración de usuarios' },
    ],
  },
  {
    title: 'Gestión de Caja',
    icon: Wallet,
    tiles: [
      // Tile real: la CashDrawerView réplica ya existe bajo el shell POS.
      { label: 'Corte de Caja', icon: Wallet, to: { name: 'pos-caja' } },
      { label: 'Resumen de Caja', icon: FileBarChart, phase: 10, phaseNote: 'Resumen administrativo de caja' },
      { label: 'Crear Nomina', icon: ReceiptText, phase: 10, phaseNote: 'Generación de nómina' },
    ],
  },
  {
    title: 'Configuración',
    icon: Settings,
    tiles: [
      // Tile real: el modal dólar ya vive en Ajustes (réplica settings.dart).
      { label: 'Configurar Dólar', icon: DollarSign, to: { name: 'pos-ajustes' } },
      { label: 'Aumento de Precios', icon: TrendingUp, phase: 9, phaseNote: 'Incremento porcentual de precios' },
      { label: 'Asignar Meseros a Mesas', icon: UserCheck, phase: 8, phaseNote: 'Meseros por mesa' },
    ],
  },
]
</script>

<template>
  <div class="ad-page">
    <!-- ===== AppBar réplica L142-158: elevation 0, bg scaffold ===== -->
    <header class="ad-appbar">
      <button
        type="button"
        class="ad-back"
        title="Regresar a módulos"
        aria-label="Regresar a módulos"
        data-testid="ad-back"
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
      <h1 class="ad-title">Administración</h1>
    </header>

    <!-- ===== Body ListView padding 24 (L159-160) ===== -->
    <main class="ad-body" data-testid="ad-body">
      <section v-for="section in SECTIONS" :key="section.title" class="ad-section">
        <!-- Section header réplica L171-191 -->
        <div class="ad-section-header">
          <component :is="section.icon" :size="22" class="ad-section-icon" aria-hidden="true" />
          <h2 class="ad-section-title">{{ section.title }}</h2>
        </div>

        <!-- Grid réplica L195-203 (desviación auto-fill documentada arriba) -->
        <div class="ad-grid">
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
            <component :is="tile.icon" :size="48" class="ad-tile-icon" aria-hidden="true" />
            <span class="ad-tile-label">{{ tile.label }}</span>
            <span v-if="tile.phase != null" class="ad-tile-badge">
              Próximamente · Fase {{ tile.phase }}
            </span>
          </component>
        </div>

        <!-- Gap 24 entre secciones (SizedBox L209) -->
        <div class="ad-section-gap" aria-hidden="true"></div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen (L141). Sin rail: standalone. */
.ad-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar (L142-158): bg = scaffold, SIN sombra (elevation 0) ===== */
.ad-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
  box-shadow: none;
}

/* IconButton back (L143-153): 48px, icono blanco */
.ad-back {
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

.ad-back:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ad-title {
  margin: 0;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

/* ===== Body ListView padding 24 ===== */
.ad-body {
  flex: 1;
  padding: 24px;
}

/* PHONE: padding compacto para que los tiles respiren a 360px */
@media (max-width: 699px) {
  .ad-body {
    padding: 12px;
  }

  .ad-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}

/* ===== Section (L168-210) ===== */
.ad-section {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* Section header (L171-191): padding v16 h8, icono 22 primary + gap 10 +
   título 20 bold white70 */
.ad-section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 8px;
}

.ad-section-icon {
  flex: none;
  color: var(--primary); /* colorScheme.primary → deepOrange */
}

.ad-section-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7); /* Colors.white70 */
}

/* Grid réplica L195-203: DESVIACIÓN MENOR — auto-fill minmax(220px, 1fr) en
   lugar de maxCrossAxisExtent 250 (CSS no lo soporta); gap 16 igual, tiles
   con aspect-ratio 1.2 igual (doc-comment arriba). */
.ad-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

/* ===== Tile = ModuleCard (home_screen2.dart L51-87) ===== */
.ad-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  aspect-ratio: 1.2; /* childAspectRatio 1.2 */
  padding: 12px;
  background: #303030; /* CardTheme grey[850] del original (todos uniformes:
                          el campo color de AppModule es código muerto) */
  border: none;
  border-radius: 12px; /* L65 */
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(0, 0, 0, 0.24); /* elevation 2 CardTheme */
  color: var(--text);
  font-family: var(--font);
  text-decoration: none;
  cursor: pointer;
  transition: box-shadow 0.2s ease;
}

/* Hover InkWell estándar: elevation 4 sutil (sin hover deepOrange) */
.ad-tile:hover {
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.3),
    0 2px 4px rgba(0, 0, 0, 0.24); /* elevation 4 sutil */
}

/* Contenido centrado (L66-82): icono 48 primary + SizedBox 16 + título bold
   16 centrado */
.ad-tile-icon {
  flex: none;
  color: var(--primary); /* theme.colorScheme.primary */
}

.ad-tile-label {
  margin-top: 16px; /* SizedBox(height: 16) */
  font-size: 16px; /* titleMedium */
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  color: var(--text);
  max-width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Badge placeholder: texto pequeño bajo el título */
.ad-tile-badge {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.2;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
}

/* Tile deshabilitado: opacity 0.45, cursor default (sin hover elevado) */
.ad-tile--disabled {
  opacity: 0.45;
  cursor: default;
}

.ad-tile--disabled:hover {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(0, 0, 0, 0.24);
}

/* Gap 24 entre secciones (SizedBox L209) */
.ad-section-gap {
  height: 24px;
}
</style>
