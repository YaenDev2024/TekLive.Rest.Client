import { createRouter, createWebHistory } from 'vue-router'
import { session, restoreSession } from './services/auth'
import LoginView from './views/LoginView.vue'
import ModuleSelectView from './views/pos/ModuleSelectView.vue'
import PosShellView from './views/pos/PosShellView.vue'
import PosPiso1View from './views/pos/PosPiso1View.vue'
import PendingOrdersView from './views/pos/PendingOrdersView.vue'
import SettingsView from './views/admin/SettingsView.vue'
import CashDrawerView from './views/admin/CashDrawerView.vue'
import AdminDashboardView from './views/admin/AdminDashboardView.vue'

/** Rutas protegidas del POS (mismo guard que /modules). */
const AUTH_ROUTES = new Set([
  'modules',
  'home',
  'admin-dashboard',
  'pos',
  'pos-piso1',
  'pos-ordenes',
  'pos-ajustes',
  'pos-caja',
])

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Fase 4: el selector de módulos es la raíz (réplica module_selection_screen).
    { path: '/', redirect: { name: 'modules' } },
    { path: '/login', name: 'login', component: LoginView },
    {
      // Selector de módulos réplica module_selection_screen.dart (Fase 4).
      path: '/modules',
      name: 'modules',
      component: ModuleSelectView,
    },
    {
      // HomeView antigua (Fase 2.5): conservada temporalmente, redirige al
      // selector réplica. NO borrada aún por si QA compara.
      path: '/home',
      name: 'home',
      redirect: { name: 'modules' },
    },
    {
      // Fase 5: hub admin réplica admin_dashboard_home.dart (standalone, sin rail)
      path: '/admin',
      name: 'admin-dashboard',
      component: AdminDashboardView,
    },
    {
      // Shell del POS (réplica desktop_home_layout): rail 80px + RouterView.
      // El rail es PERSISTENTE entre las 4 vistas (el carrito vive en Pinia
      // y NO se pierde al navegar, igual que el NavigationProvider Flutter).
      path: '/pos',
      name: 'pos',
      component: PosShellView,
      children: [
        { path: '', redirect: { name: 'pos-piso1' } },
        {
          // Vender (index 0 del rail) — Menú + panel de orden 290px.
          path: 'piso1',
          name: 'pos-piso1',
          component: PosPiso1View,
        },
        {
          // Órdenes (index 1) — réplica pending_orders_screen.dart.
          path: 'ordenes',
          name: 'pos-ordenes',
          component: PendingOrdersView,
        },
        {
          // Ajustes (index 2) — réplica settings.dart (2 ListTiles).
          path: 'ajustes',
          name: 'pos-ajustes',
          component: SettingsView,
        },
        {
          // Caja (index 3) — placeholder cash_drawer_screen (estado sin sesión).
          path: 'caja',
          name: 'pos-caja',
          component: CashDrawerView,
        },
      ],
    },
    // QA directa del panel de pendientes (compatibilidad ronda 1).
    {
      path: '/pos/piso1/pendientes',
      redirect: { name: 'pos-ordenes' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (AUTH_ROUTES.has(to.name as string)) {
    // Sin token en memoria NO se opera el POS (antes el guard dejaba pasar y
    // cada API respondía 401 → "Error inesperado"). Tras un reload ambos
    // tokens se pierden (memoria-only): no hay nada que rotar → login con el
    // número de empleado prefilled desde el perfil persistido.
    if (session.accessToken != null) return true
    restoreSession()
    return { name: 'login' }
  }
  if (to.name === 'login' && session.accessToken != null) {
    return { name: 'modules' }
  }
  return true
})

export default router
