<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  Store,
} from 'lucide-vue-next'
import { ApiError } from '../api/client'
import { activateApp, getMe, loginEmployee } from '../api/rest'
import {
  applyTokens,
  getDeviceId,
  persistLicenseKey,
  persistSession,
  session,
} from '../services/auth'

const router = useRouter()

/**
 * Step 1: activation (owner, LICENSE_KEY).
 * Step 2: employee login (employeeNumber + password).
 *
 * Verified backend shapes (BusinessSuite, Fase 1A):
 * - POST /api/saas/auth/loginApp → { Token } — NO companyId in body.
 *   The license JWT carries a `CompanyId` claim → decoded client-side.
 *   If decoding fails, a manual companyId input appears as dev fallback
 *   (TODO(backend): include companyId in the loginApp response).
 * - POST /api/rest/auth/login → { Token, RefreshToken, User }.
 */
type Step = 'activate' | 'login'

const step = ref<Step>(session.companyId != null ? 'login' : 'activate')

const licenseKey = ref(session.licenseKey ?? '')
const manualCompanyId = ref(session.companyId != null ? String(session.companyId) : '')
const showManualCompanyId = ref(false)
const employeeNumber = ref(session.employeeNumber ?? '')
const password = ref('')

const activating = ref(false)
const loggingIn = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')

const canActivate = computed(() => licenseKey.value.trim().length > 0 && !activating.value)
const canLogin = computed(
  () => employeeNumber.value.trim().length > 0 && password.value.length >= 6 && !loggingIn.value,
)

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

async function activate(): Promise<void> {
  errorMessage.value = ''
  infoMessage.value = ''
  activating.value = true
  try {
    const { data } = await activateApp(licenseKey.value.trim())
    persistLicenseKey(licenseKey.value.trim())

    const payload = decodeJwtPayload(data.token)
    const claimCompanyId = payload?.['CompanyId']
    const resolvedCompanyId = Number(claimCompanyId)

    if (Number.isFinite(resolvedCompanyId) && resolvedCompanyId > 0) {
      persistSession({ companyId: resolvedCompanyId, employeeNumber: null, displayName: null, role: null })
      infoMessage.value = 'Licencia activada. Continúa con tu número de empleado.'
    } else {
      // Backend gap: loginApp does not return companyId and JWT decode failed.
      showManualCompanyId.value = true
      infoMessage.value =
        'Licencia activada, pero no se pudo resolver la empresa automáticamente. Ingresa el ID de empresa.'
      // TODO(backend): add companyId to the loginApp response so this
      // manual fallback can be removed.
    }
    step.value = 'login'
  } catch (err) {
    errorMessage.value =
      err instanceof ApiError ? err.message : 'No se pudo activar la licencia. Intenta de nuevo.'
  } finally {
    activating.value = false
  }
}

async function login(): Promise<void> {
  errorMessage.value = ''
  infoMessage.value = ''
  const companyId = session.companyId ?? Number(manualCompanyId.value)
  if (!Number.isFinite(companyId) || companyId <= 0) {
    showManualCompanyId.value = true
    errorMessage.value = 'Falta el ID de empresa (companyId).'
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

/** Back to activation (e.g. wrong company or license change). */
function backToActivation(): void {
  step.value = 'activate'
  errorMessage.value = ''
  infoMessage.value = ''
}
</script>

<template>
  <div class="rl-page">
    <div class="rl-card">
      <div class="rl-brand">
        <Store :size="26" aria-hidden="true" />
        <span class="rl-brand-name">TekLive Rest</span>
      </div>

      <div class="rl-steps" aria-hidden="true">
        <div class="rl-step-dot" :class="{ active: step === 'activate' }" />
        <div class="rl-step-dot" :class="{ active: step === 'login' }" />
      </div>

      <div
        v-if="errorMessage"
        class="rl-banner error"
        role="alert"
        aria-live="assertive"
      >
        <AlertCircle :size="18" aria-hidden="true" />
        <span>{{ errorMessage }}</span>
      </div>
      <div v-if="infoMessage" class="rl-banner info" role="status" aria-live="polite">
        <Info :size="18" aria-hidden="true" />
        <span>{{ infoMessage }}</span>
      </div>

      <!-- Step 1: activation -->
      <template v-if="step === 'activate'">
        <h1 class="rl-title">Activar restaurante</h1>
        <p class="rl-sub">
          Ingresa la clave de licencia que recibiste al contratar TekLive Rest.
        </p>

        <form @submit.prevent="activate" novalidate>
          <label class="rl-field">
            <span class="rl-field-label">Clave de licencia</span>
            <input
              v-model="licenseKey"
              type="text"
              class="rl-input"
              placeholder="XXXX-XXXX-XXXX"
              autocomplete="off"
              spellcheck="false"
              :disabled="activating"
            />
          </label>

          <button type="submit" class="rl-btn" :disabled="!canActivate">
            <Loader2 v-if="activating" class="rl-spinner" :size="18" aria-hidden="true" />
            <KeyRound v-else :size="18" aria-hidden="true" />
            <span>{{ activating ? 'Activando…' : 'Activar' }}</span>
          </button>
        </form>
      </template>

      <!-- Step 2: employee login -->
      <template v-else>
        <h1 class="rl-title">Inicio de sesión</h1>
        <p class="rl-sub">
          Restaurante TekLive Demo · Empresa #{{ session.companyId ?? '—' }}
        </p>

        <form @submit.prevent="login" novalidate>
          <label v-if="showManualCompanyId" class="rl-field">
            <span class="rl-field-label">ID de empresa (fallback)</span>
            <input
              v-model="manualCompanyId"
              type="number"
              min="1"
              class="rl-input"
              placeholder="15"
              autocomplete="off"
              :disabled="loggingIn"
            />
            <p class="rl-hint">
              Solo necesario si la activación no resolvió la empresa (pendiente en backend).
            </p>
          </label>

          <label class="rl-field">
            <span class="rl-field-label">Número de empleado</span>
            <input
              v-model="employeeNumber"
              type="text"
              inputmode="numeric"
              class="rl-input"
              placeholder="1001"
              autocomplete="username"
              spellcheck="false"
              :disabled="loggingIn"
            />
          </label>

          <label class="rl-field">
            <span class="rl-field-label">Contraseña</span>
            <input
              v-model="password"
              type="password"
              class="rl-input"
              placeholder="••••••••"
              autocomplete="current-password"
              :disabled="loggingIn"
            />
          </label>

          <button type="submit" class="rl-btn" :disabled="!canLogin">
            <Loader2 v-if="loggingIn" class="rl-spinner" :size="18" aria-hidden="true" />
            <LogIn v-else :size="18" aria-hidden="true" />
            <span>{{ loggingIn ? 'Entrando…' : 'Entrar' }}</span>
            <ArrowRight v-if="!loggingIn" :size="18" aria-hidden="true" />
          </button>
        </form>

        <button
          type="button"
          class="rl-btn ghost"
          style="margin-top: 12px"
          :disabled="loggingIn"
          @click="backToActivation"
        >
          Usar otra licencia
        </button>
      </template>

      <div v-if="step === 'login' && session.companyId != null" class="rl-hint" style="margin-top: 14px; display: flex; align-items: center; gap: 6px;">
        <span>✓ Licencia verificada · Empresa #{{ session.companyId }}</span>
      </div>
    </div>
  </div>
</template>
