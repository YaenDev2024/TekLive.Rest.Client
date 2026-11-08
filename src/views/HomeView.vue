<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { LogOut, ScanBarcode, Utensils } from 'lucide-vue-next'
import { clearSession, session } from '../services/auth'
import { roleLabel } from '../utils/role-labels'
import { AppButton } from '../components/ui'

const router = useRouter()

const displayName = computed(() => session.displayName ?? 'Empleado')
const roleLabelText = computed(() => roleLabel(session.role))

/** Sesión restaurada tras recarga (tryResumeSession OK con token en memoria). */
const sessionRestored = computed(() => session.accessToken != null)

async function logout(): Promise<void> {
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="home-page">
    <!-- Header: réplica module_selection_screen.dart (grey[850] + shadow) -->
    <header class="home-header">
      <div class="home-header-brand">
        <img
          class="home-logo"
          src="/logoWText.png"
          alt="Crazy Wings"
          width="160"
          height="44"
        />
      </div>

      <div class="home-header-user">
        <div class="home-user-meta">
          <span class="home-user-name">Bienvenido, {{ displayName }}</span>
          <span v-if="roleLabelText" class="home-user-role">{{ roleLabelText }}</span>
        </div>
        <AppButton variant="ghost" :block="false" aria-label="Cerrar sesión" @click="logout">
          <template #icon><LogOut :size="16" /></template>
          Cerrar sesión
        </AppButton>
      </div>
    </header>

    <main class="home-main">
      <p v-if="sessionRestored" class="home-restored">Sesión restaurada</p>

      <h1 class="home-title">Selecciona un módulo</h1>

      <!-- Grid de módulos: cards de module_selection_screen.dart (280×180 desktop) -->
      <div class="home-modules">
        <!-- POS Piso 1: ACTIVO desde Fase 3 ronda 1 -->
        <RouterLink
          to="/pos/piso1"
          class="home-module home-module--active"
          data-testid="module-pos-piso1"
        >
          <div class="home-module-icon">
            <ScanBarcode :size="30" aria-hidden="true" />
          </div>
          <h2 class="home-module-title">POS Piso 1</h2>
          <p class="home-module-subtitle">Punto de venta</p>
        </RouterLink>

        <article class="home-module" aria-disabled="true" title="Disponible en Fase 4">
          <div class="home-module-icon">
            <Utensils :size="30" aria-hidden="true" />
          </div>
          <h2 class="home-module-title">Restaurante Piso 2</h2>
          <p class="home-module-subtitle">Sistema de mesas</p>
          <span class="home-module-phase">Fase 4</span>
        </article>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* Header Flutter: Container grey[850], shadow black 0.2 / blur 8 / offset 0,2 */
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  background: var(--bg-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.home-logo {
  height: 44px;
  width: auto;
  border-radius: 8px;
  object-fit: contain;
}

.home-header-user {
  display: flex;
  align-items: center;
  gap: 16px;
}

.home-user-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
}

/* "Bienvenido, {nombre}" 20px bold blanco (desktop) */
.home-user-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

/* "Rol: {rol}" 14px grey[400] */
.home-user-role {
  font-size: 13px;
  color: var(--text-muted);
}

.home-main {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 24px;
}

.home-restored {
  margin: 0 0 16px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--info);
}

/* Título 28px bold blanco (desktop Flutter) */
.home-title {
  margin: 0 0 40px;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
}

.home-modules {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 280px));
  gap: 32px;
  justify-content: center;
}

/* _ModuleCard Flutter: grey[850] + overlay black 0.2, radius 12, 280×180 */
.home-module {
  position: relative;
  aspect-ratio: 280 / 180;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  background:
    linear-gradient(var(--card-overlay), var(--card-overlay)),
    var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: not-allowed;
  opacity: 0.5;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  text-decoration: none;
}

/* Card activa (POS Piso 1, Fase 3 ronda 1): sin overlay ni cursor prohibido. */
.home-module--active {
  cursor: pointer;
  opacity: 1;
}

.home-module--active:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary), var(--shadow);
}

.home-module:hover {
  border-color: var(--primary);
}

/* Icono deepOrange 28-32px */
.home-module-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
}

.home-module-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  text-align: center;
}

.home-module-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--text-muted);
  text-align: center;
}

/* Badge de fase (pill deepOrange en Flutter; aquí discreto por ser placeholder) */
.home-module-phase {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--card-overlay);
  border: 1px solid var(--border);
  color: var(--text-faint);
  text-transform: uppercase;
}

@media (max-width: 600px) {
  .home-header {
    padding: 16px;
  }

  .home-main {
    padding: 24px 16px;
  }

  .home-title {
    font-size: 22px;
    margin-bottom: 24px;
  }

  .home-modules {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
