import { createRouter, createWebHistory } from 'vue-router'
import { session, restoreSession, tryResumeSession } from './services/auth'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: { name: 'home' } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/home', name: 'home', component: HomeView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (to.name === 'home') {
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
