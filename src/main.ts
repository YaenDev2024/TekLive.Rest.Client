import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { clearSession } from './services/auth'
import { setSessionExpiredHandler } from './api/client'

const pinia = createPinia()

// 401 sin posibilidad de refresh (refresh token usado/revocado/inexistente):
// la sesión murió → logout en memoria + redirect al login. El perfil
// no-sensible (número de empleado) sobrevive en localStorage para el prefill.
setSessionExpiredHandler(() => {
  clearSession()
  void router.push({ name: 'login' })
})

createApp(App).use(pinia).use(router).mount('#app')
