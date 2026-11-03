<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, KeyRound, Lock, Settings2, ShieldAlert, User, X } from 'lucide-vue-next'
import { ApiError } from '../api/client'
import { activateApp, getMe, loginEmployee } from '../api/rest'
import {
  applyTokens,
  getDeviceId,
  persistLicenseKey,
  persistSession,
  restoreSession,
  session,
} from '../services/auth'
import { AppBanner, AppButton, AppInput } from '../components/ui'

const router = useRouter()

/**
 * Login de empleado (employeeNumber + password) — réplica de login_screen.dart
 * (gradiente 135° #303030→#212121, card rgba(0,0,0,0.2) radius 16, logo 210px).
 *
 * La ACTIVACIÓN DE LICENCIA no es parte del login: es un flujo SaaS bajo el
 * capó (como Abogados/SPA). El dueño activa el restaurante UNA vez por
 * dispositivo (modal desde el engrane); el companyId queda persistido y a
 * partir de ahí los empleados entran directo con número + contraseña.
 *
 * Backend shapes verificados (BusinessSuite, Fase 1A):
 * - POST /api/saas/auth/loginApp → { Token } — sin companyId en el body;
 *   el claim `CompanyId` del JWT de licencia se decodifica client-side.
 *   (TODO(backend): incluir companyId en la respuesta de loginApp.)
 * - POST /api/rest/auth/login → { Token, RefreshToken, User }.
 */

// Restaurar el perfil persistido (companyId/employeeNumber del dispositivo)
// para que el login funcione directo tras un reload, sin reprocesos.
restoreSession()

const employeeNumber = ref(session.employeeNumber ?? '')
const password = ref('')
const showPassword = ref(false)

const loggingIn = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')

// --- Activación (modal, no es un paso del login) ---
const showActivation = ref(false)
const licenseKey = ref(session.licenseKey ?? '')
const manualCompanyId = ref(session.companyId != null ? String(session.companyId) : '')
const showManualCompanyId = ref(false)
const activating = ref(false)
const activationError = ref('')

const canLogin = computed(
  () => employeeNumber.value.trim().length > 0 && password.value.length >= 6 && !loggingIn.value,
)
const canActivate = computed(() => licenseKey.value.trim().length > 0 && !activating.value)

/** Decode JWT payload without verifying signature (client-side convenience). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Activación del restaurante (dueño, una vez por dispositivo). */
async function activate(): Promise<void> {
  activationError.value = ''
  activating.value = true
  try {
    const { data } = await activateApp(licenseKey.value.trim())
    persistLicenseKey(licenseKey.value.trim())

    const payload = decodeJwtPayload(data.token)
    const claimCompanyId = payload?.['CompanyId']
    const resolvedCompanyId = Number(claimCompanyId)

    if (Number.isFinite(resolvedCompanyId) && resolvedCompanyId > 0) {
      persistSession({ companyId: resolvedCompanyId, employeeNumber: null, displayName: null, role: null })
      showActivation.value = false
      infoMessage.value = 'Restaurante activado. Ingresa tu número de empleado.'
    } else {
      // Backend gap: loginApp no devuelve companyId y falló el decode del JWT.
      showManualCompanyId.value = true
      activationError.value =
        'Licencia activada, pero no se pudo resolver la empresa automáticamente. Ingresa el ID de empresa.'
      // TODO(backend): add companyId to the loginApp response so this
      // manual fallback can be removed.
    }
  } catch (err) {
    activationError.value =
      err instanceof ApiError ? err.message : 'No se pudo activar la licencia. Intenta de nuevo.'
  } finally {
    activating.value = false
  }
}

async function login(): Promise<void> {
  errorMessage.value = ''
  infoMessage.value = ''
  const companyId = session.companyId
  if (companyId == null || companyId <= 0) {
    showManualCompanyId.value = session.licenseKey == null
    activationError.value = ''
    showActivation.value = true
    errorMessage.value = 'Este dispositivo aún no tiene un restaurante activado.'
    return
  }

  loggingIn.value = true
  try {
    const { data } = await loginEmployee({
      companyId,
      employeeNumber: employeeNumber.value.trim(),
      password: password.value,
      deviceId: getDeviceId(),
      deviceName: 'TekLive Rest (web)',
      platform: 'web',
    })

    // Access token stays in memory only.
    applyTokens(data.token, data.refreshToken)

    // Persist the non-sensitive profile (employee identity for next visits).
    persistSession({
      companyId,
      employeeNumber: employeeNumber.value.trim(),
      displayName: `${data.user.firstName} ${data.user.lastName}`.trim(),
      role: data.user.role,
    })

    // Enrich display name from /me when available (canonical profile).
    try {
      const { data: meData } = await getMe()
      persistSession({
        companyId: meData.companyId ?? companyId,
        employeeNumber: meData.employeeNumber ?? employeeNumber.value.trim(),
        displayName: `${meData.firstName} ${meData.lastName}`.trim(),
        role: meData.role,
      })
    } catch {
      // /me is optional enrichment; login response already has the essentials.
    }

    await router.push({ name: 'home' })
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

function openActivation(): void {
  activationError.value = ''
  showManualCompanyId.value = false
  showActivation.value = true
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
      <AppBanner v-if="infoMessage" type="info" role="status" aria-live="polite">
        {{ infoMessage }}
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

      <!-- Activación de restaurante: flujo de dueño, discreto (no es parte
           del ingreso del empleado). -->
      <button
        type="button"
        class="login-activation"
        :aria-label="session.companyId != null ? 'Reactivar restaurante' : 'Activar restaurante'"
        title="Activar restaurante"
        :disabled="loggingIn"
        @click="openActivation"
      >
        <Settings2 :size="16" />
      </button>
    </div>

    <!-- Modal de activación (dueño) -->
    <div v-if="showActivation" class="activation-overlay" @click.self="showActivation = false">
      <div class="activation-modal" role="dialog" aria-modal="true" aria-label="Activar restaurante">
        <div class="activation-head">
          <h2>Activar restaurante</h2>
          <button type="button" class="activation-close" aria-label="Cerrar" @click="showActivation = false">
            <X :size="18" />
          </button>
        </div>
        <p class="activation-hint">
          Ingresa la licencia del restaurante (una sola vez en este dispositivo).
        </p>

        <AppBanner v-if="activationError" type="error" role="alert">
          <template #icon><ShieldAlert :size="18" /></template>
          {{ activationError }}
        </AppBanner>

        <form @submit.prevent="activate" novalidate>
          <AppInput
            v-model="licenseKey"
            label="Licencia"
            placeholder="XXXX-XXXX-XXXX"
            autocomplete="off"
            :spellcheck="false"
            :disabled="activating"
          >
            <template #prefix><KeyRound :size="20" /></template>
          </AppInput>

          <AppInput
            v-if="showManualCompanyId"
            v-model="manualCompanyId"
            label="ID de empresa (fallback)"
            type="number"
            placeholder="15"
            :disabled="activating"
            helper-text="Solo necesario si la activación no resolvió la empresa (pendiente en backend)."
          >
            <template #prefix><User :size="20" /></template>
          </AppInput>

          <AppButton
            type="submit"
            variant="primary"
            class="activation-submit"
            :loading="activating"
            :disabled="!canActivate"
          >
            {{ activating ? 'Activando…' : 'Activar' }}
          </AppButton>
        </form>
      </div>
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

.login-step {
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

.login-logo + .app-banner,
.login-step .app-banner {
  margin-bottom: 12px;
}

.login-submit {
  margin-top: 20px;
}

/* Engrane discreto de activación (esquina inferior de la card) */
.login-activation {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: 0;
  border-radius: 8px;
  color: var(--text-faint);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.login-activation:hover:not(:disabled) {
  opacity: 1;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.06);
}

.login-activation:disabled {
  cursor: not-allowed;
}

/* --- Modal de activación --- */
.activation-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}

.activation-modal {
  width: 100%;
  max-width: 380px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  padding: 20px;
}

.activation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.activation-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}

.activation-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: none;
  border: 0;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
}

.activation-close:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.activation-hint {
  margin: 0 0 12px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.activation-submit {
  margin-top: 16px;
}
</style>
