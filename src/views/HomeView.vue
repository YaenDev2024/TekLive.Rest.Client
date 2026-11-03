<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { CreditCard, LayoutGrid, LogOut, Store, UtensilsCrossed } from 'lucide-vue-next'
import { clearSession, session } from '../services/auth'

const router = useRouter()

const displayName = computed(() => session.displayName ?? 'Empleado')
const roleLabel = computed(() => {
  switch (session.role) {
    case 'RestAdmin':
      return 'Administrador'
    case 'RestManager':
      return 'Gerente'
    case 'RestCashier':
      return 'Cajero'
    case 'RestWaiter':
      return 'Mesero'
    case 'RestKitchen':
      return 'Cocina'
    default:
      return session.role ?? ''
  }
})
const initials = computed(() => displayName.value.slice(0, 1).toUpperCase())

async function logout(): Promise<void> {
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="rl-page column">
    <header class="rl-header">
      <div class="rl-header-user">
        <div class="rl-brand" style="margin: 0">
          <Store :size="24" aria-hidden="true" />
          <span class="rl-brand-name">TekLive Rest</span>
        </div>
      </div>

      <div class="rl-header-user">
        <div class="rl-avatar" aria-hidden="true">{{ initials || '?' }}</div>
        <div>
          <div class="rl-user-name">{{ displayName }}</div>
          <div class="rl-user-role">{{ roleLabel }}</div>
        </div>
        <button
          type="button"
          class="rl-btn ghost"
          style="margin-left: 8px"
          aria-label="Cerrar sesión"
          @click="logout"
        >
          <LogOut :size="16" aria-hidden="true" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </header>

    <main class="rl-main">
      <h1 class="rl-title">Panel principal</h1>
      <p class="rl-sub">
        Módulos disponibles para {{ displayName }}
        <template v-if="roleLabel"> · {{ roleLabel }}</template>. Próximas fases habilitarán la operación.
      </p>

      <div class="rl-cards">
        <article class="rl-module-card" aria-disabled="true">
          <span class="rl-badge">Fase 3</span>
          <div class="rl-module-icon"><CreditCard :size="22" aria-hidden="true" /></div>
          <h2 class="rl-module-title">POS Piso 1</h2>
          <p class="rl-module-desc">
            Venta rápida, catálogo con templates/opciones, folios diarios y caja
            (abrir/cerrar/reconciliación).
          </p>
        </article>

        <article class="rl-module-card" aria-disabled="true">
          <span class="rl-badge">Fase 4</span>
          <div class="rl-module-icon"><UtensilsCrossed :size="22" aria-hidden="true" /></div>
          <h2 class="rl-module-title">Restaurante Piso 2</h2>
          <p class="rl-module-desc">
            Piso en vivo, mesas, sesiones, cuentas divididas y facturación master.
          </p>
        </article>

        <article class="rl-module-card">
          <span class="rl-badge">Activo</span>
          <div class="rl-module-icon"><LayoutGrid :size="22" aria-hidden="true" /></div>
          <h2 class="rl-module-title">Sesión</h2>
          <p class="rl-module-desc">
            Empresa #{{ session.companyId ?? '—' }} · Dispositivo
            {{ session.deviceId ? 'registrado' : 'sin registrar' }}. El token vive solo en memoria.
          </p>
        </article>
      </div>
    </main>
  </div>
</template>
