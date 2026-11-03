<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, Hash, KeyRound, Lock, ShieldAlert, User } from 'lucide-vue-next'
import { ApiError } from '../api/client'
import { activateApp, getMe, loginEmployee } from '../api/rest'
import {
  applyTokens,
  getDeviceId,
  persistLicenseKey,
  persistSession,
  session,
} from '../services/auth'
import { AppBanner, AppButton, AppInput } from '../components/ui'

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
 *
 * Fase 2.5: la capa visual replica login_screen.dart de CrazyWings
 * (gradiente 135° #303030→#212121, card rgba(0,0,0,0.2) radius 16,
 * logo 210px). La lógica E2E probada NO cambió.
 */
type Step = 'activate' | 'login'

const step = ref<Step>(session.companyId != null ? 'login' : 'activate')

const licenseKey = ref(session.licenseKey ?? '')
const manualCompanyId = ref(session.companyId != null ? String(session.companyId) : '')
const showManualCompanyId = ref(false)
const employeeNumber = ref(session.employeeNumber ?? '')
const password = ref('')
const showPassword = ref(false)

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
  <div class="login-page">
    <div class="login-card">
      <p class="login-brand">TekLive Rest</p>

      <Transition name="step-fade" mode="out-in">
        <!-- Step 1: activation -->
        <div v-if="step === 'activate'" key="activate" class="login-step">
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

          <form @submit.prevent="activate" novalidate>
            <AppInput
              v-model="licenseKey"
              label="License key"
              placeholder="XXXX-XXXX-XXXX"
              autocomplete="off"
              :spellcheck="false"
              :disabled="activating"
            >
              <template #prefix><KeyRound :size="20" /></template>
            </AppInput>

            <AppButton
              type="submit"
              variant="primary"
              class="login-submit"
              :loading="activating"
              :disabled="!canActivate"
            >
              {{ activating ? 'Activando…' : 'Activar' }}
            </AppButton>
          </form>
        </div>

        <!-- Step 2: employee login -->
        <div v-else key="login" class="login-step">
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
              v-if="showManualCompanyId"
              v-model="manualCompanyId"
              label="ID de empresa (fallback)"
              type="number"
              placeholder="15"
              :disabled="loggingIn"
              helper-text="Solo necesario si la activación no resolvió la empresa (pendiente en backend)."
            >
              <template #prefix><Hash :size="20" /></template>
            </AppInput>

            <AppInput
              v-model="employeeNumber"
              label="Número de empleado"
              placeholder="1001"
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

          <button type="button" class="login-back" :disabled="loggingIn" @click="backToActivation">
            Cambiar restaurante
          </button>
        </div>
      </Transition>
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
  width: 100%;
  max-width: 380px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 32px 24px;
}

.login-brand {
  margin: 0 0 8px;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
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
  margin: 0 auto 8px;
  object-fit: contain;
}

.login-logo + .app-banner,
.login-step .app-banner {
  margin-bottom: 12px;
}

.login-submit {
  margin-top: 20px;
}

.login-back {
  margin-top: 12px;
  align-self: center;
  background: none;
  border: 0;
  padding: 8px 12px;
  font-family: var(--font);
  font-size: 0.9rem;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 8px;
}

.login-back:hover:not(:disabled) {
  color: var(--text);
  text-decoration: underline;
}

.login-back:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Transición suave entre pasos (fade + slide, como AnimatedOpacity Flutter) */
.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.step-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.step-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
