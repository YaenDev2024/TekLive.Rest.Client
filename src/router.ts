import { createRouter, createWebHistory } from 'vue-router'
import { session, restoreSession } from './services/auth'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import PosShellView from './views/pos/PosShellView.vue'
import PosPiso1View from './views/pos/PosPiso1View.vue'
import PendingOrdersView from './views/pos/PendingOrdersView.vue'
import SettingsView from './views/admin/SettingsView.vue'
import CashDrawerView from './views/admin/CashDrawerView.vue'

/** Rutas protegidas del POS (mismo guard que /home). */
const AUTH_ROUTES = new Set([
  'home',
  'pos',
  'pos-piso1',
  'pos-ordenes',
  'pos-ajustes',
  'pos-caja',
])

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: { name: 'home' } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/home', name: 'home', component: HomeView },
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
    return { name: 'home' }
  }
  return true
})

export default router
