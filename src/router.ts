import { createRouter, createWebHistory } from 'vue-router'
import { session, restoreSession, tryResumeSession } from './services/auth'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import PosPiso1View from './views/pos/PosPiso1View.vue'

/** Rutas protegidas del POS (mismo guard que /home). */
const AUTH_ROUTES = new Set(['home', 'pos-piso1', 'pos-piso1-pendientes'])

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: { name: 'home' } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/home', name: 'home', component: HomeView },
    {
      path: '/pos/piso1',
      name: 'pos-piso1',
      component: PosPiso1View,
    },
    {
      // QA directa del panel de pendientes (el flujo normal lo abre como
      // modal desde el POS; esta ruta monta la vista standalone con close → POS).
      path: '/pos/piso1/pendientes',
      name: 'pos-piso1-pendientes',
      component: PosPiso1View,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (AUTH_ROUTES.has(to.name as string)) {
    if (session.accessToken != null) return true
    // Web reload wipes memory tokens. Restore the persisted profile (used to
    // prefill the login) and try to transparently resume; if not possible,
    // go to login (employee number will be prefilled from the profile).
    restoreSession()
    const resumed = await tryResumeSession()
    if (resumed) return true
    return { name: 'login' }
  }
  if (to.name === 'login' && session.accessToken != null) {
    return { name: 'home' }
  }
  return true
})

export default router
