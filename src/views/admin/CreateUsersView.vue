<script setup lang="ts">
/**
 * CreateUsersView · "Crear Usuarios" (Fase 7 PARTE A) — réplica de
 * lib/screens/admin/user_settings_screen.dart (CrazyWings) con la estructura
 * de ManageCategoriesView.vue (Fase 6.2): AppBar standalone + card de form +
 * toasts + guard de rol.
 *
 * Estructura replicada del Flutter:
 * - AppBar: back → admin-dashboard, título 'Crear Usuarios' (el tile del
 *   dashboard; el original dice 'Crear Nuevo Usuario').
 * - Form (L139-195): Card 'Información del Usuario' (L165-171) + grid de
 *   campos + ElevatedButton 'Crear Usuario' (L175-186).
 * - Campos (labels EXACTOS L207/212/218/222/226/344): Nombre*, Número de
 *   empleado*, Apellido Paterno*, Apellido Materno, Contraseña* + Email*
 *   (el Flutter no lo tiene pero el backend Rest lo REQUIERE —
 *   RestCreateUserAdminRequest.Email [Required], único global) + Rol*
 *   (L321-366 dropdown de GET roles) + Estado activo (switch; el backend
 *   trae IsActive default true).
 * - FECHAS OMITIDAS (Fecha Contratación / Fecha Nacimiento L229-269): el
 *   modelo AUTH de BusinessSuite NO las tiene (son del legacy SQL Server del
 *   Flutter) — el backend Rest no las recibe.
 * - Validaciones réplica de los validators (L289-295 'Por favor, ingresa
 *   X' / L360-364 'Por favor, selecciona un rol') + password mínimo 6
 *   (backend L: 'La contraseña debe tener al menos 6 caracteres.') + email
 *   formato básico (backend: 'El formato del email no es válido.').
 * - Éxito (L119-131): SnackBar verde → toast.success 'Usuario creado' +
 *   reset del form; el rol NO se limpia aquí (mantener rol — petición del
 *   brief; el original sí lo resetea a null, desviación consciente).
 * - Error (L132-140): SnackBar rojo 'Error al crear usuario: $e' →
 *   toast.error con err.message (los 400 del backend traen mensaje claro).
 * - Roles loading/error (L321-339): spinner / 'No se pudieron cargar los
 *   roles: $e' + Reintentar / 'No hay roles activos configurados.'
 *
 * DESVIACIONES CONSCIENTES (mismas que las demás vistas admin):
 * - SnackBars del Flutter → toasts (useToastStore).
 * - Card Material → card del design system (var(--bg-surface)).
 * - Iconos lucide (User, AtSign, Lock, KeyRound).
 * - AppSelect SIEMPRE en dropdowns (NUNCA <select> nativo — bug iOS PWA).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AtSign, Eye, EyeOff, KeyRound, User } from 'lucide-vue-next'
import AppSelect from '../../components/ui/AppSelect.vue'
import { AppSpinner } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminUsersStore } from '../../stores/adminUsers'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'

const router = useRouter()
const store = useAdminUsersStore()
const toast = useToastStore()

// --- Guard de rol (mismo patrón que ManageCategoriesView onMounted) -----------
// El backend exige SOLO RestAdmin/SuperAdmin para gestionar usuarios
// (RestManager queda fuera — RestUsersAdminController.CanManageUsers).

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadRoles()
})

// --- goBack: back arrow del AppBar → admin-dashboard ---------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Form de alta (réplica _UserSettingsFormState) -------------------------------

const firstName = ref('')
const numeroEmpleado = ref('')
const apepat = ref('')
const apemat = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const selectedRole = ref<string | null>(null)
const isActive = ref(true)
const creating = ref(false)

/** Opciones del AppSelect de rol (mismo shape que dropdown L341-354). */
const roleOptions = computed(() =>
  store.roles.map((role) => ({ value: role.id, label: role.name })),
)

/** Validación de email básica (backend valida formato igual — UX temprana). */
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))

/**
 * Submit réplica _createUser (L101-142) con las validaciones de los
 * validators (L289-295/L360-364) + password/email del backend.
 */
async function submitCreate(): Promise<void> {
  if (creating.value) return
  if (firstName.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Nombre') // réplica validator L290-292
    return
  }
  if (numeroEmpleado.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Número de empleado')
    return
  }
  if (apepat.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Apellido Paterno')
    return
  }
  if (email.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Email') // backend: 'El email es requerido.'
    return
  }
  if (!emailValid.value) {
    toast.warning('El formato del email no es válido') // backend validation
    return
  }
  if (password.value.length < 6) {
    toast.warning('La contraseña debe tener al menos 6 caracteres') // backend
    return
  }
  if (selectedRole.value == null) {
    toast.warning('Por favor, selecciona un rol') // réplica validator L360-362
    return
  }

  creating.value = true
  try {
    await store.createUser({
      firstName: firstName.value.trim(),
      lastName: apepat.value.trim() + (apemat.value.trim().length > 0 ? ` ${apemat.value.trim()}` : ''),
      email: email.value.trim(),
      numeroEmpleado: numeroEmpleado.value.trim(),
      password: password.value,
      role: selectedRole.value,
      isActive: isActive.value,
    })
    toast.success('Usuario creado') // L119-124: SnackBar verde (message)
    // L125-131: reset + clear; el rol se MANTIENE (petición del brief).
    firstName.value = ''
    numeroEmpleado.value = ''
    apepat.value = ''
    apemat.value = ''
    email.value = ''
    password.value = ''
    showPassword.value = false
    isActive.value = true
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error al crear usuario: ${err.message}` // L136: 'Error al crear usuario: $e'
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="cu-page">
    <!-- ===== AppBar réplica: back + título ===== -->
    <header class="cu-appbar">
      <button
        type="button"
        class="cu-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="cu-back"
        @click="goBack"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="cu-appbar-title">Crear Usuarios</h1>
      <div class="cu-appbar-actions"></div>
    </header>

    <main class="cu-body">
      <!-- ===== Card 'Información del Usuario' (L153-195) ===== -->
      <section class="cu-form-card" data-testid="cu-form">
        <h2 class="cu-form-title">Información del Usuario</h2>

        <div class="cu-field">
          <label class="cu-label" for="cu-nombre">Nombre</label>
          <input
            id="cu-nombre"
            v-model="firstName"
            type="text"
            class="cu-input"
            data-testid="cu-nombre"
            autocomplete="off"
            maxlength="100"
          />
        </div>

        <div class="cu-field">
          <label class="cu-label" for="cu-numero">Número de empleado</label>
          <input
            id="cu-numero"
            v-model="numeroEmpleado"
            type="text"
            class="cu-input"
            data-testid="cu-numero"
            autocomplete="off"
            maxlength="50"
          />
        </div>

        <div class="cu-row">
          <div class="cu-field">
            <label class="cu-label" for="cu-apepat">Apellido Paterno</label>
            <input
              id="cu-apepat"
              v-model="apepat"
              type="text"
              class="cu-input"
              data-testid="cu-apepat"
              autocomplete="off"
              maxlength="100"
            />
          </div>
          <div class="cu-field">
            <label class="cu-label" for="cu-apemat">Apellido Materno</label>
            <input
              id="cu-apemat"
              v-model="apemat"
              type="text"
              class="cu-input"
              data-testid="cu-apemat"
              autocomplete="off"
              maxlength="100"
            />
          </div>
        </div>

        <div class="cu-field">
          <label class="cu-label" for="cu-email">Email</label>
          <div class="cu-input-wrap">
            <span class="cu-input-icon" aria-hidden="true"><AtSign :size="18" /></span>
            <input
              id="cu-email"
              v-model="email"
              type="email"
              class="cu-input"
              data-testid="cu-email"
              autocomplete="off"
              inputmode="email"
              maxlength="255"
            />
          </div>
        </div>

        <div class="cu-field">
          <label class="cu-label" for="cu-password">Contraseña</label>
          <div class="cu-input-wrap">
            <span class="cu-input-icon" aria-hidden="true"><KeyRound :size="18" /></span>
            <input
              id="cu-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="cu-input"
              data-testid="cu-password"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="cu-eye"
              :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              data-testid="cu-eye"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>
        </div>

        <!-- ===== Rol (L321-366): AppSelect OBLIGATORIO (nunca <select>) ===== -->
        <div class="cu-field">
          <span class="cu-label">Rol</span>
          <div v-if="store.rolesLoading" class="cu-roles-state" data-testid="cu-roles-loading">
            <AppSpinner :size="22" tone="primary" />
          </div>
          <template v-else-if="store.rolesError != null">
            <p class="cu-roles-error" data-testid="cu-roles-error">
              No se pudieron cargar los roles: {{ store.rolesError }}
            </p>
            <button
              type="button"
              class="cu-retry-link"
              data-testid="cu-roles-retry"
              @click="store.loadRoles(true)"
            >
              Reintentar
            </button>
          </template>
          <p v-else-if="roleOptions.length === 0" class="cu-roles-error" data-testid="cu-roles-empty">
            No hay roles activos configurados.
          </p>
          <AppSelect
            v-else
            v-model="selectedRole"
            :options="roleOptions"
            placeholder="Selecciona un rol"
            testid="cu-rol"
            aria-label="Rol"
          />
        </div>

        <!-- ===== Estado activo (switch — IsActive default true del backend) ===== -->
        <label class="cu-switch" data-testid="cu-activo">
          <input v-model="isActive" type="checkbox" />
          <span class="cu-switch-track" aria-hidden="true"></span>
          <span class="cu-switch-label">Estado activo</span>
        </label>

        <button
          type="button"
          class="cu-btn cu-btn--primary cu-btn--block"
          data-testid="cu-submit"
          :disabled="creating"
          @click="submitCreate"
        >
          <User v-if="!creating" :size="20" aria-hidden="true" />
          <AppSpinner v-else :size="18" tone="light" />
          Crear Usuario
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Scaffold full-screen standalone (mismo layout que ManageCategoriesView). */
.cu-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0 ===== */
.cu-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.cu-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.cu-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 48px;
}

/* IconButton 48px circular, hover white08 (patrón ManageCategoriesView) */
.cu-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.cu-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado ===== */
.cu-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 16px 24px;
}

/* ===== Card del form (L153-163: Card radius 12 + Padding 24) ===== */
.cu-form-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.cu-form-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700; /* headlineSmall bold (L165-171) */
  color: var(--text);
}

.cu-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* labelText: labelStyle grey (patrón .cat-label) */
.cu-label {
  font-size: 12px;
  color: var(--text-faint);
}

/* Input con icono prefijo/sufijo (look AppInput: fill negro .3, outline
   grey[700] radius 12, focused deepOrange) */
.cu-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s ease;
}

.cu-input-wrap:focus-within {
  border-color: var(--primary);
}

.cu-input-icon {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  flex: none;
}

.cu-input-wrap .cu-input {
  border: none;
  background: transparent;
  padding: 12px 0;
}

/* Input simple (sin icono): mismo look inline */
.cu-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s ease;
}

.cu-input:focus {
  border-color: var(--primary);
}

/* Toggle mostrar/ocultar contraseña (réplica LoginView suffix) */
.cu-eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: -6px;
  flex: none;
  background: none;
  border: 0;
  border-radius: 8px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.cu-eye:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

/* Fila de 2 columnas (Apepat/Apemat — Row L214-224 del Flutter) */
.cu-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* ===== Estado de roles (L321-339) ===== */
.cu-roles-state {
  display: flex;
  align-items: center;
  padding: 10px 0;
}

.cu-roles-error {
  margin: 0;
  font-size: 13px;
  color: var(--error);
  word-break: break-word;
}

.cu-retry-link {
  align-self: flex-start;
  padding: 2px 0;
  background: none;
  border: none;
  color: var(--primary);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

/* ===== Switch 'Estado activo' (mismo checkbox estilizado que
   ProductEditorView .pe-switch) ===== */
.cu-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
  -webkit-user-select: none;
  user-select: none;
  align-self: flex-start;
}

.cu-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.cu-switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.15s ease;
}

.cu-switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #bdbdbd;
  transition: transform 0.15s ease, background 0.15s ease;
}

.cu-switch input:checked + .cu-switch-track {
  background: var(--primary);
}

.cu-switch input:checked + .cu-switch-track::after {
  transform: translateX(18px);
  background: #ffffff;
}

.cu-switch input:focus-visible + .cu-switch-track {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.cu-switch-label {
  font-size: 15px;
  color: var(--text);
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.cu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

/* ElevatedButton L175-186: height 50, fontSize default */
.cu-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.cu-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.cu-btn--block {
  height: 50px; /* SizedBox(height: 50) L175 */
  margin-top: 8px;
}

.cu-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Responsive básico (móvil first: el usuario usa iPhone PWA) ===== */
@media (max-width: 560px) {
  .cu-appbar-title {
    font-size: 19px;
  }

  .cu-body {
    padding: 8px 12px 20px;
  }

  .cu-form-card {
    padding: 16px;
  }

  .cu-row {
    grid-template-columns: 1fr; /* móvil: single-column L246-273 */
  }
}
</style>
