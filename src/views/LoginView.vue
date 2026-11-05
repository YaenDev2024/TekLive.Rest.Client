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

    // CrazyWings desktop arranca con rail + Vender directo (NavigationProvider
    // index 0): el login aterriza en el shell del POS, no en la selección de
    // módulos (esa queda como ruta /home para el rol mesero en fases futuras).
    await router.push({ name: 'pos-piso1' })
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
      <img
        class="login-logo"
        src="/logo.png"
        alt="Crazy Wings"
        width="210"
        height="210"
      />

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
/* Réplica de login_screen.dart: gradiente topLeft→bottomRight #303030→#212121 */
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, #303030 0%, #212121 100%);
}

/* Card Flutter: rgba(0,0,0,0.2), radius 16, elevation 8, max 380, pad 24/32 */
.login-card {
  position: relative;
  width: 100%;
  max-width: 380px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
}

/* Logo Flutter: assets/logo.png height 210 centrado */
.login-logo {
  display: block;
  height: 210px;
  width: auto;
  margin: 0 auto 16px;
  object-fit: contain;
}

.login-logo + .app-banner {
  margin-bottom: 12px;
}

.login-submit {
  margin-top: 20px;
}
</style>
