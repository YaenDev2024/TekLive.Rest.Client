<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, Lock, ShieldAlert, User } from 'lucide-vue-next'
import { ApiError } from '../api/client'
import { getMe, loginEmployee } from '../api/rest'
import { applyTokens, getDeviceId, persistSession, restoreSession, session } from '../services/auth'
import { AppBanner, AppButton, AppInput } from '../components/ui'

const router = useRouter()

/**
 * Login de empleado (employeeNumber + password) — réplica de login_screen.dart
 * (gradiente 135° #303030→#212121, card rgba(0,0,0,0.2) radius 16, logo 210px).
 *
 * Sin activación de licencia y sin companyId del cliente: el backend deduce
 * la empresa desde el número de empleado (único global). El companyId del
 * usuario autenticado (data.user.companyId) queda solo en memoria por si una
 * vista lo necesita.
 *
 * Backend shape (BusinessSuite):
 * - POST /api/rest/auth/login → { token, refreshToken, user } (camelCase).
 */

// Restaurar el perfil persistido para prefill del número de empleado
// (el router solo lo restaura al entrar a /home).
restoreSession()
const employeeNumber = ref(session.employeeNumber ?? '')
const password = ref('')
const showPassword = ref(false)

const loggingIn = ref(false)
const errorMessage = ref('')

const canLogin = computed(
  () => employeeNumber.value.trim().length > 0 && password.value.length >= 6 && !loggingIn.value,
)

async function login(): Promise<void> {
  errorMessage.value = ''

  loggingIn.value = true
  try {
    const { data } = await loginEmployee({
      employeeNumber: employeeNumber.value.trim(),
      password: password.value,
      deviceId: getDeviceId(),
      deviceName: 'TekLive Rest (web)',
      platform: 'web',
    })

    // Access token stays in memory only.
    applyTokens(data.token, data.refreshToken)

    // Persist the non-sensitive profile (employee identity for next visits).
    // companyId is intentionally NOT persisted: server-side concern.
    persistSession({
      employeeNumber: employeeNumber.value.trim(),
      displayName: `${data.user.firstName} ${data.user.lastName}`.trim(),
      role: data.user.role,
    })

    // Enrich display name from /me when available (canonical profile).
    try {
      const { data: meData } = await getMe()
      persistSession({
        employeeNumber: meData.employeeNumber ?? employeeNumber.value.trim(),
        displayName: `${meData.firstName} ${meData.lastName}`.trim(),
        role: meData.role,
      })
    } catch {
      // /me is optional enrichment; login response already has the essentials.
    }

    // Fase 4 (réplica module_selection_screen.dart): el login aterriza en el
    // selector de módulos; cada card decide su gate de caja y destino.
    await router.push({ name: 'modules' })
  } catch (err) {
    if (err instanceof ApiError) {
      errorMessage.value = err.message
    } else {
      errorMessage.value = 'No se pudo iniciar sesión. Intenta de nuevo.'
    }
  } finally {
    loggingIn.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img
          class="login-logo"
          src="/logo.png"
          alt="Crazy Wings"
          width="210"
          height="210"
        />
        <div class="login-heading">
          <h1 class="login-title">Iniciar sesión</h1>
          <p class="login-subtitle">Punto de venta</p>
        </div>
      </div>

      <AppBanner v-if="errorMessage" type="error" role="alert" aria-live="assertive">
        <template #icon><ShieldAlert :size="18" /></template>
        {{ errorMessage }}
      </AppBanner>

      <form @submit.prevent="login" novalidate>
        <AppInput
          v-model="employeeNumber"
          label="Número de empleado"
          placeholder="Ej. 1001"
          autocomplete="username"
          :inputmode="'numeric'"
          :spellcheck="false"
          :disabled="loggingIn"
        >
          <template #prefix><User :size="20" /></template>
        </AppInput>

        <AppInput
          v-model="password"
          label="Contraseña"
          :type="showPassword ? 'text' : 'password'"
          placeholder="••••••••"
          autocomplete="current-password"
          :disabled="loggingIn"
        >
          <template #prefix><Lock :size="20" /></template>
          <template #suffix>
            <button
              type="button"
              :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </template>
        </AppInput>

        <AppButton
          type="submit"
          variant="primary"
          class="login-submit"
          :loading="loggingIn"
          :disabled="!canLogin"
        >
          Ingresar
        </AppButton>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* Fondo neutro con un halo de acento muy tenue detrás de la card
   (profundidad sutil, sin gradientes decorativos estridentes). */
.login-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
  overflow: hidden;
}

.login-page::before {
  content: '';
  position: absolute;
  top: -30%;
  left: 50%;
  width: 720px;
  height: 720px;
  transform: translateX(-50%);
  background: radial-gradient(circle, rgba(255, 100, 45, 0.09), transparent 62%);
  pointer-events: none;
}

/* Card: superficie propia, borde discreto, sombra natural */
.login-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
}

/* Marca: logo contenido + título/subtítulo alineados a la izquierda */
.login-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 26px;
}

.login-logo {
  display: block;
  width: 56px;
  height: 56px;
  flex: none;
  object-fit: contain;
}

.login-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.login-title {
  margin: 0;
  font-size: var(--text-h1);
  font-weight: 600;
  letter-spacing: -0.022em;
  line-height: 1.2;
  color: var(--text-1);
}

.login-subtitle {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}

.login-card form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-logo + .app-banner {
  margin-bottom: 12px;
}

.login-submit {
  margin-top: 6px;
}

/* PHONE: card casi a ancho completo, padding más ajustado. Con el teclado
   abierto la card sube para que el CTA siga visible (regla global). */
@media (max-width: 699px) {
  .login-page {
    padding: 16px;
    align-items: center;
  }

  .login-card {
    max-width: min(400px, calc(100vw - 32px));
    padding: 26px 20px;
    border-radius: var(--radius-lg);
  }

  .login-brand {
    gap: 14px;
    margin-bottom: 22px;
  }

  .login-logo {
    width: 46px;
    height: 46px;
  }

  .login-title {
    font-size: 20px;
  }
}

@media (max-height: 700px) {
  .login-logo {
    width: 44px;
    height: 44px;
  }

  .login-brand {
    margin-bottom: 18px;
  }
}
</style>
