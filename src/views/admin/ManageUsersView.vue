<script setup lang="ts">
/**
 * ManageUsersView · "Gestionar Usuarios" (Fase 7 PARTE B+C) — réplica de
 * lib/screens/admin/manage_users_screen.dart (CrazyWings, 863 líneas) con la
 * estructura de ManageCategoriesView.vue (Fase 6.2): AppBar standalone +
 * buscador + cards + AppModal dialogs + toasts + guard de rol.
 *
 * Estructura replicada del Flutter:
 * - AppBar (L308-330): back → admin-dashboard, título 'Gestionar Usuarios',
 *   acción refresh (L323-329 IconButton refresh).
 * - Buscador (L333-359): TextField 'Buscar usuario...' con icono search —
 *   aquí input con icono Search. Filtro client-side _filterUsers (L88-103):
 *   nombre/apellido/número/empleado — aquí + email (brief).
 * - Lista (L361-618): spinner / error+Reintentar / vacío ('No hay usuarios
 *   registrados' sin búsqueda | 'No se encontraron usuarios' con búsqueda,
 *   L402-413) / cards.
 * - Card (L434-616): nombre completo en MAYÚSCULAS bold (L460-471) + badge
 *   de rol + badge Activo/Inactivo (L504-536: verde/rojo alpha) + 'N.º
 *   empleado: X' (L548-554) + email (extra del backend Rest) + acciones
 *   editar (lápiz) + desactivar (papelera roja SOLO si isActive, L583-608).
 *   El backend Rest NO trae fechaContratación → se omite la fecha gris
 *   (L538-544, dato del legacy SQL Server).
 * - Confirm desactivar (L253-297): título 'Desactivar Usuario', texto
 *   '¿Estás seguro de que deseas desactivar a X Y? No podrá iniciar sesión.',
 *   botones Cancelar/Desactivar (rojo L292). SnackBar con el message del
 *   backend (L274-279) → toast.
 * - Dialog editar (L626-898): Nombre (L725-732), Número de empleado SOLO
 *   LECTURA (el backend NO permite cambiarlo — RestUpdateUserAdminRequest no
 *   tiene el campo; el Flutter L734-741 lo dejaba editable, desviación
 *   consciente por contrato backend), Apellido Paterno + Materno (L743-764),
 *   Email (extra backend), Rol dropdown (L778-796), Estado activo (switch),
 *   Nueva Contraseña opcional con hint 'Dejar vacío para no cambiar'
 *   (L767-776), pisos asignados (L798-831 Wrap de FilterChip 'Piso #N' —
 *   PARTE C) + Cancelar/Guardar (L864-895).
 * - REACTIVAR: el Flutter no la tiene (su lista solo marcaba inactivos);
 *   aquí botón Reactivar en cards inactivas → PUT isActive=true (el backend
 *   lo permite) — petición explícita del brief.
 * - Self-guard visual (brief): si la card es el usuario de la sesión
 *   (comparamos numeroEmpleado de session vs card — la sesión web no guarda
 *   el id numérico, solo employeeNumber), se OCULTA Desactivar (el backend
 *   lo rechazaría con 400 'No puedes desactivar tu propia cuenta.').
 *
 * PARTE C — Asignación de pisos (L123-158 + L798-831 del Flutter):
 * - Al abrir el dialog se carga GET users/{id}/floors (asignaciones) y los
 *   pisos SIEMPRE de la API real getFloors() de rest.ts (getFloors del
 *   cliente ya existe; NO se usa el fallback demo del floors store).
 * - UI: chips toggle por piso (assigned = activo), réplica FilterChip.
 * - Guardar: si el usuario tocó pisos → PUT users/{id}/floors con la lista
 *   COMPLETA { assignments: [{ sucursalId: S, plantId: N }] } (sucursalId =
 *   POS_SUCURSAL_ID = 1); si no tocó nada → SOLO PUT user (brief).
 * - Si la carga de pisos falla: banner discreto NO bloqueante (la edición
 *   del usuario sigue funcionando).
 *
 * DESVIACIONES CONSCIENTES (mismas que las demás vistas admin):
 * - SnackBars → toasts (useToastStore); AlertDialog → AppModal.
 * - Iconos lucide (Pencil/Trash2/RotateCcw/Search/RefreshCw).
 * - Avatar-inicial (primera letra del nombre) en lugar de icono.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  CircleAlert,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import AppSelect from '../../components/ui/AppSelect.vue'
import { AppSpinner } from '../../components/ui'
import {
  getAdminUserFloors,
  getFloors,
  replaceAdminUserFloors,
  type RestFloorResponse,
} from '../../api/rest'
import { session } from '../../services/auth'
import { useAdminUsersStore } from '../../stores/adminUsers'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { RestAdminUser } from '../../api/rest'

const router = useRouter()
const store = useAdminUsersStore()
const toast = useToastStore()

// --- Guard de rol (mismo patrón que CreateUsersView): SOLO RestAdmin/SuperAdmin

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadUsers()
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

// --- Búsqueda client-side (L333-359 + _filterUsers L88-103) --------------------

const search = computed({
  get: () => store.searchQuery,
  set: (value: string) => {
    store.searchQuery = value
  },
})

// --- Helpers de card ------------------------------------------------------------

/** Nombre completo réplica L461: '$nombre $apepat $apemat'.toUpperCase(). */
function fullName(user: RestAdminUser): string {
  return `${user.firstName} ${user.lastName}`.trim().toUpperCase()
}

/** Inicial del avatar (primera letra del nombre, o '?' si vacío). */
function initial(user: RestAdminUser): string {
  const first = user.firstName.trim()
  return first.length > 0 ? first.charAt(0).toUpperCase() : '?'
}

/** Etiqueta del rol desde el catálogo (fallback: el id crudo). */
function roleLabel(roleId: string): string {
  return store.roles.find((role) => role.id === roleId)?.name ?? roleId
}

/**
 * Color del badge de rol (brief: Admin=rojo/primario, Manager=naranja,
 * Cajero=azul, Mesero=verde, Cocina=gris — tonos del tema).
 */
function roleBadgeClass(roleId: string): string {
  switch (roleId) {
    case 'RestAdmin':
    case 'SuperAdmin':
      return 'mu-badge--admin'
    case 'RestManager':
      return 'mu-badge--manager'
    case 'RestCashier':
      return 'mu-badge--cashier'
    case 'RestWaiter':
      return 'mu-badge--waiter'
    default:
      return 'mu-badge--kitchen'
  }
}

/**
 * Self-guard visual (brief): la sesión web guarda employeeNumber (no el id
 * numérico) — comparamos numeroEmpleado de la sesión vs card. En SU propia
 * card se oculta Desactivar (el backend lo rechazaría con 400).
 */
function isSelf(user: RestAdminUser): boolean {
  const selfNumber = session.employeeNumber
  return selfNumber != null && selfNumber.length > 0 && user.numeroEmpleado === selfNumber
}

// --- Confirm desactivar (L253-297) ----------------------------------------------

type DialogKind = 'none' | 'edit' | 'confirm'

const dialogKind = ref<DialogKind>('none')
const confirmingUser = ref<RestAdminUser | null>(null)
const deactivating = ref(false)

function openConfirm(user: RestAdminUser): void {
  confirmingUser.value = user
  dialogKind.value = 'confirm'
}

function closeDialog(): void {
  if (saving.value || deactivating.value) return
  dialogKind.value = 'none'
  confirmingUser.value = null
  editingUser.value = null
}

/** Desactivar tras confirm (réplica L267-292: DELETE soft + SnackBar). */
async function confirmDeactivate(): Promise<void> {
  if (confirmingUser.value == null || deactivating.value) return
  deactivating.value = true
  try {
    await store.deactivateUser(confirmingUser.value.id)
    toast.success('Usuario desactivado') // L274-279: SnackBar(message)
    dialogKind.value = 'none'
    confirmingUser.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error al desactivar usuario: ${err.message}` // L283-289
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deactivating.value = false
  }
}

/** Reactivar card inactiva (PUT isActive=true — sin dialog, acción directa). */
const reactivatingId = ref<number | null>(null)

async function reactivate(user: RestAdminUser): Promise<void> {
  if (reactivatingId.value != null) return
  reactivatingId.value = user.id
  try {
    await store.reactivateUser(user.id, user)
    toast.success('Usuario reactivado')
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error al reactivar usuario: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    reactivatingId.value = null
  }
}

// --- Dialog editar (L626-898) + PARTE C pisos ----------------------------------

const editingUser = ref<RestAdminUser | null>(null)
const editFirstName = ref('')
const editNumeroEmpleado = ref('')
/** Apellido paterno/materno: el backend Rest trae lastName compuesto — se
 *  divide en el primer espacio (paterno) + resto (materno). */
const editApepat = ref('')
const editApemat = ref('')
const editEmail = ref('')
const editRole = ref<string | null>(null)
const editIsActive = ref(true)
const editPassword = ref('')
const editShowPassword = ref(false)
const saving = ref(false)

const roleOptions = computed(() =>
  store.roles.map((role) => ({ value: role.id, label: role.name })),
)

/** Divide lastName compuesto en paterno/materno (inverso del create). */
function splitLastName(lastName: string): { apepat: string; apemat: string } {
  const trimmed = lastName.trim()
  if (trimmed.length === 0) return { apepat: '', apemat: '' }
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex < 0) return { apepat: trimmed, apemat: '' }
  return { apepat: trimmed.slice(0, spaceIndex), apemat: trimmed.slice(spaceIndex + 1) }
}

// --- PARTE C: pisos (L123-158 carga + L798-831 chips) ---------------------------

/** Pisos de la API real (getFloors de rest.ts — SIN fallback demo). */
const availableFloors = ref<RestFloorResponse[]>([])
const floorsLoading = ref(false)
const floorsError = ref<string | null>(null)
/** plantIds asignados al abrir el dialog (estado guardado). */
const initialFloorIds = ref<number[]>([])
/** plantIds marcados en los chips (estado editable). */
const assignedFloorIds = ref<number[]>([])
/** true cuando el usuario tocó al menos un chip → al guardar se manda PUT floors. */
const floorsTouched = ref(false)
const floorsSaving = ref(false)

/**
 * Carga pisos + asignaciones al abrir el dialog (réplica L123-158: getFloors
 * + getUserFloorAssignments). Error NO bloqueante: la edición sigue.
 */
async function loadFloors(userId: number): Promise<void> {
  floorsLoading.value = true
  floorsError.value = null
  floorsTouched.value = false
  try {
    // Pisos SIEMPRE de la API real (getFloors de rest.ts, desenrollado).
    const floorsResult = await getFloors()
    availableFloors.value = floorsResult.data ?? []
  } catch (err) {
    availableFloors.value = []
    floorsError.value =
      err instanceof ApiError && err.status !== 0
        ? `No se pudieron cargar los pisos: ${err.message}`
        : 'No se pudieron cargar los pisos (sin conexión).'
  }
  try {
    const { data } = await getAdminUserFloors(userId)
    const assignments = data.assignments ?? []
    initialFloorIds.value = assignments
      .filter((a) => a.isActive && a.sucursalId > 0)
      .map((a) => a.plantId)
    assignedFloorIds.value = [...initialFloorIds.value]
  } catch {
    // Asignaciones no disponibles: se asume vacío (banner ya avisó si falló
    // la lista de pisos; aquí es silencioso para no duplicar ruido).
    initialFloorIds.value = []
    assignedFloorIds.value = []
  } finally {
    floorsLoading.value = false
  }
}

/** Toggle de chip réplica FilterChip onSelected (L812-827). */
function toggleFloor(plantId: number): void {
  floorsTouched.value = true
  if (assignedFloorIds.value.includes(plantId)) {
    assignedFloorIds.value = assignedFloorIds.value.filter((id) => id !== plantId)
  } else {
    assignedFloorIds.value = [...assignedFloorIds.value, plantId]
  }
}

// --- Apertura/cierre/guardado del dialog editar ----------------------------------

function openEdit(user: RestAdminUser): void {
  editingUser.value = user
  editFirstName.value = user.firstName
  editNumeroEmpleado.value = user.numeroEmpleado // SOLO LECTURA
  const { apepat, apemat } = splitLastName(user.lastName)
  editApepat.value = apepat
  editApemat.value = apemat
  editEmail.value = user.email
  editRole.value = store.roles.some((role) => role.id === user.role) ? user.role : null
  editIsActive.value = user.isActive
  editPassword.value = ''
  editShowPassword.value = false
  dialogKind.value = 'edit'
  void loadFloors(user.id) // PARTE C: carga pisos al abrir (fire-and-forget)
}

/**
 * Guardar edición (réplica onSave L168-248): PUT user + (si el usuario tocó
 * pisos) PUT floors con la lista COMPLETA. Toasts réplica L229-247.
 */
async function submitEdit(): Promise<void> {
  if (editingUser.value == null || saving.value) return
  if (editFirstName.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Nombre')
    return
  }
  if (editApepat.value.trim().length === 0) {
    toast.warning('Por favor, ingresa Apellido Paterno')
    return
  }
  const emailTrimmed = editEmail.value.trim()
  if (emailTrimmed.length === 0) {
    toast.warning('Por favor, ingresa Email')
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
    toast.warning('El formato del email no es válido')
    return
  }
  if (editPassword.value.length > 0 && editPassword.value.length < 6) {
    toast.warning('La contraseña debe tener al menos 6 caracteres')
    return
  }
  if (editRole.value == null) {
    toast.warning('Por favor, selecciona un rol')
    return
  }

  saving.value = true
  try {
    await store.updateUser(editingUser.value.id, {
      firstName: editFirstName.value.trim(),
      lastName:
        editApepat.value.trim() +
        (editApemat.value.trim().length > 0 ? ` ${editApemat.value.trim()}` : ''),
      email: emailTrimmed,
      role: editRole.value,
      isActive: editIsActive.value,
      password: editPassword.value.length > 0 ? editPassword.value : null,
    })

    // PARTE C: solo si el usuario TOCÓ los chips → reemplazo completo.
    if (floorsTouched.value) {
      floorsSaving.value = true
      try {
        await replaceAdminUserFloors(editingUser.value.id, {
          assignments: assignedFloorIds.value.map((plantId) => ({
            sucursalId: POS_SUCURSAL_ID,
            plantId,
          })),
        })
      } finally {
        floorsSaving.value = false
      }
    }

    toast.success('Usuario actualizado exitosamente') // L230-235: SnackBar verde
    dialogKind.value = 'none'
    editingUser.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error al actualizar usuario: ${err.message}` // L238-246
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mu-page">
    <!-- ===== AppBar réplica L308-330: back + título + refresh ===== -->
    <header class="mu-appbar">
      <button
        type="button"
        class="mu-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="mu-back"
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
      <h1 class="mu-appbar-title">Gestionar Usuarios</h1>
      <div class="mu-appbar-actions">
        <button
          type="button"
          class="mu-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="mu-refresh"
          @click="store.loadUsers(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="mu-body">
      <!-- ===== Buscador réplica L333-359 ===== -->
      <div class="mu-search-wrap">
        <div class="mu-search">
          <Search :size="20" class="mu-search-icon" aria-hidden="true" />
          <input
            v-model="search"
            type="text"
            class="mu-search-input"
            placeholder="Buscar usuario..."
            aria-label="Buscar usuario"
            data-testid="mu-search"
            autocomplete="off"
          />
        </div>
      </div>

      <!-- ===== Lista réplica L361-618: spinner / error / vacío / cards ===== -->
      <div class="mu-list-wrap">
        <div v-if="store.loading" class="mu-state" data-testid="mu-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="store.error != null" class="mu-state" data-testid="mu-error">
          <CircleAlert :size="64" class="mu-state-error-icon" aria-hidden="true" />
          <p class="mu-state-text">{{ store.error }}</p>
          <button
            type="button"
            class="mu-retry"
            data-testid="mu-retry"
            @click="store.loadUsers(true)"
          >
            Reintentar
          </button>
        </div>

        <p
          v-else-if="store.filteredUsers.length === 0"
          class="mu-state mu-empty"
          data-testid="mu-empty"
        >
          {{ search.trim().length > 0 ? 'No se encontraron usuarios' : 'No hay usuarios registrados' }}
        </p>

        <ul v-else class="mu-list" data-testid="mu-list">
          <li
            v-for="user in store.filteredUsers"
            :key="user.id"
            class="mu-card"
            :data-testid="`mu-item-${user.id}`"
          >
            <span class="mu-avatar" :class="{ 'mu-avatar--inactive': !user.isActive }">
              {{ initial(user) }}
            </span>
            <span class="mu-item-info">
              <span class="mu-item-name" :class="{ 'mu-item-name--inactive': !user.isActive }">
                {{ fullName(user) }}
              </span>
              <span class="mu-item-meta">
                <span class="mu-badge" :class="roleBadgeClass(user.role)">
                  {{ roleLabel(user.role) }}
                </span>
                <span class="mu-status" :class="user.isActive ? 'mu-status--active' : 'mu-status--inactive'">
                  {{ user.isActive ? 'Activo' : 'Inactivo' }}
                </span>
              </span>
              <span class="mu-item-sub">N.º empleado: {{ user.numeroEmpleado }}</span>
              <span v-if="user.email" class="mu-item-email">{{ user.email }}</span>
            </span>
            <span class="mu-item-actions">
              <button
                type="button"
                class="mu-item-btn"
                :aria-label="`Editar ${user.firstName}`"
                :data-testid="`mu-edit-${user.id}`"
                @click="openEdit(user)"
              >
                <Pencil :size="20" aria-hidden="true" />
              </button>
              <!-- Desactivar SOLO si isActive (L583-608) y NO es self-guard -->
              <button
                v-if="user.isActive && !isSelf(user)"
                type="button"
                class="mu-item-btn mu-item-btn--delete"
                :aria-label="`Desactivar ${user.firstName}`"
                :data-testid="`mu-delete-${user.id}`"
                @click="openConfirm(user)"
              >
                <Trash2 :size="20" aria-hidden="true" />
              </button>
              <!-- Reactivar card inactiva (brief) -->
              <button
                v-if="!user.isActive"
                type="button"
                class="mu-item-btn mu-item-btn--reactivate"
                :aria-label="`Reactivar ${user.firstName}`"
                :data-testid="`mu-reactivate-${user.id}`"
                :disabled="reactivatingId === user.id"
                @click="reactivate(user)"
              >
                <AppSpinner v-if="reactivatingId === user.id" :size="16" tone="primary" />
                <RotateCcw v-else :size="20" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </main>

    <!-- ===== Confirm desactivar (L253-297): texto EXACTO del Flutter ===== -->
    <AppModal
      v-if="dialogKind === 'confirm' && confirmingUser != null"
      title="Desactivar Usuario"
      :width="420"
      @close="closeDialog"
    >
      <p class="mu-confirm-text" data-testid="mu-confirm-text">
        ¿Estás seguro de que deseas desactivar a {{ confirmingUser.firstName }}
        {{ confirmingUser.lastName }}? No podrá iniciar sesión.
      </p>
      <template #footer>
        <button
          type="button"
          class="mu-btn mu-btn--ghost"
          data-testid="mu-confirm-cancel"
          :disabled="deactivating"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="mu-btn mu-btn--danger"
          data-testid="mu-confirm-ok"
          :disabled="deactivating"
          @click="confirmDeactivate"
        >
          <AppSpinner v-if="deactivating" :size="16" tone="light" />
          Desactivar
        </button>
      </template>
    </AppModal>

    <!-- ===== Dialog editar (L626-898) + PARTE C pisos ===== -->
    <AppModal
      v-if="dialogKind === 'edit' && editingUser != null"
      title="Editar Usuario"
      :width="480"
      @close="closeDialog"
    >
      <form class="mu-form" @submit.prevent="submitEdit">
        <div class="mu-field">
          <label class="mu-label" for="mu-edit-nombre">Nombre</label>
          <input
            id="mu-edit-nombre"
            v-model="editFirstName"
            type="text"
            class="mu-input"
            data-testid="mu-edit-nombre"
            autocomplete="off"
            maxlength="100"
          />
        </div>

        <!-- Número de empleado SOLO LECTURA (backend no lo permite cambiar) -->
        <div class="mu-field">
          <label class="mu-label" for="mu-edit-numero">Número de empleado</label>
          <input
            id="mu-edit-numero"
            :value="editNumeroEmpleado"
            type="text"
            class="mu-input"
            data-testid="mu-edit-numero"
            readonly
            aria-readonly="true"
            title="El número de empleado no se puede cambiar"
          />
        </div>

        <div class="mu-row">
          <div class="mu-field">
            <label class="mu-label" for="mu-edit-apepat">Apellido Paterno</label>
            <input
              id="mu-edit-apepat"
              v-model="editApepat"
              type="text"
              class="mu-input"
              data-testid="mu-edit-apepat"
              autocomplete="off"
              maxlength="100"
            />
          </div>
          <div class="mu-field">
            <label class="mu-label" for="mu-edit-apemat">Apellido Materno</label>
            <input
              id="mu-edit-apemat"
              v-model="editApemat"
              type="text"
              class="mu-input"
              data-testid="mu-edit-apemat"
              autocomplete="off"
              maxlength="100"
            />
          </div>
        </div>

        <div class="mu-field">
          <label class="mu-label" for="mu-edit-email">Email</label>
          <input
            id="mu-edit-email"
            v-model="editEmail"
            type="email"
            class="mu-input"
            data-testid="mu-edit-email"
            autocomplete="off"
            inputmode="email"
            maxlength="255"
          />
        </div>

        <!-- Rol: AppSelect OBLIGATORIO (nunca <select> — bug iOS PWA) -->
        <div class="mu-field">
          <span class="mu-label">Rol</span>
          <AppSelect
            v-model="editRole"
            :options="roleOptions"
            placeholder="Selecciona un rol"
            testid="mu-edit-rol"
            aria-label="Rol"
          />
        </div>

        <!-- Estado activo (switch) -->
        <label class="mu-switch" data-testid="mu-edit-activo">
          <input v-model="editIsActive" type="checkbox" />
          <span class="mu-switch-track" aria-hidden="true"></span>
          <span class="mu-switch-label">Estado activo</span>
        </label>

        <!-- Nueva Contraseña opcional (L767-776) -->
        <div class="mu-field">
          <label class="mu-label" for="mu-edit-password">Nueva Contraseña</label>
          <div class="mu-input-wrap">
            <input
              id="mu-edit-password"
              v-model="editPassword"
              :type="editShowPassword ? 'text' : 'password'"
              class="mu-input mu-input--bare"
              data-testid="mu-edit-password"
              placeholder="Dejar vacío para no cambiar"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="mu-eye"
              :aria-label="editShowPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              @click="editShowPassword = !editShowPassword"
            >
              <svg
                v-if="editShowPassword"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        <!-- ===== PARTE C: pisos asignados (L798-831 Wrap FilterChip) ===== -->
        <div class="mu-floors" data-testid="mu-floors">
          <span class="mu-floors-title">Pisos asignados</span>

          <div v-if="floorsLoading" class="mu-floors-state" data-testid="mu-floors-loading">
            <AppSpinner :size="20" tone="primary" />
          </div>

          <p v-else-if="floorsError != null" class="mu-floors-error" data-testid="mu-floors-error">
            {{ floorsError }}
          </p>

          <template v-else-if="availableFloors.length > 0">
            <div class="mu-chips">
              <button
                v-for="floor in availableFloors"
                :key="floor.floorId"
                type="button"
                class="mu-chip"
                :class="{ 'mu-chip--selected': assignedFloorIds.includes(floor.floorId) }"
                :data-testid="`mu-chip-piso-${floor.floorId}`"
                :aria-pressed="assignedFloorIds.includes(floor.floorId)"
                @click="toggleFloor(floor.floorId)"
              >
                <MapPin :size="14" aria-hidden="true" />
                {{ floor.name }}
              </button>
            </div>
            <span class="mu-floors-hint">Meseros/atención por piso — el guardado reemplaza todas las asignaciones.</span>
          </template>

          <p v-else class="mu-floors-hint" data-testid="mu-floors-empty">Sin pisos disponibles.</p>
        </div>
      </form>
      <template #footer>
        <button
          type="button"
          class="mu-btn mu-btn--ghost"
          data-testid="mu-edit-cancel"
          :disabled="saving"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="mu-btn mu-btn--primary"
          data-testid="mu-edit-save"
          :disabled="saving"
          @click="submitEdit"
        >
          <AppSpinner v-if="saving" :size="16" tone="light" />
          Guardar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* Scaffold full-screen standalone (mismo layout que ManageCategoriesView). */
.mu-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, refresh a la derecha ===== */
.mu-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.mu-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.mu-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 */
.mu-icon-btn {
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

.mu-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado ===== */
.mu-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== Buscador (L333-359: fill cardBg, radius 12, icono search) ===== */
.mu-search-wrap {
  padding: 16px 16px 0;
}

.mu-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color 0.15s ease;
}

.mu-search:focus-within {
  border-color: var(--primary);
  border-width: 2px;
}

.mu-search-icon {
  flex: none;
  color: var(--primary); /* Icon search color _primaryColor (L342) */
}

.mu-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
}

.mu-search-input::placeholder {
  color: var(--text-faint); /* hintStyle Colors.grey (L341) */
}

/* ===== Lista: Expanded + ListView padding 16 ===== */
.mu-list-wrap {
  flex: 1;
  padding: 16px;
}

.mu-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.mu-empty {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.mu-state-error-icon {
  color: var(--error);
}

.mu-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar' */
.mu-retry {
  padding: 12px 24px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.mu-retry:hover {
  background: var(--primary-hover);
}

/* ===== Card de usuario (Card _cardBg radius 12 border #3A3A3A, L434-444) ===== */
.mu-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mu-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 8px 14px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-soft); /* BorderSide #3A3A3A */
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* Avatar-inicial (CircleAvatar del brief): primary alpha, gris si inactivo */
.mu-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.22);
  color: var(--primary);
  font-size: 18px;
  font-weight: 700;
}

.mu-avatar--inactive {
  background: rgba(158, 158, 158, 0.25); /* Colors.grey alpha */
  color: #9e9e9e;
}

.mu-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Nombre MAYÚSCULAS bold (L460-471); tachado si inactivo (estilo
   mc-item-name--inactive de ManageCatalogView) */
.mu-item-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-item-name--inactive {
  text-decoration: line-through;
  opacity: 0.75;
}

.mu-item-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

/* Badge de rol (color por rol — brief) */
.mu-badge {
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.mu-badge--admin {
  background: rgba(255, 87, 34, 0.2); /* rojo/primario */
  border: 1px solid var(--primary);
  color: var(--primary);
}

.mu-badge--manager {
  background: rgba(255, 152, 0, 0.18); /* naranja --warning */
  border: 1px solid var(--warning);
  color: var(--warning);
}

.mu-badge--cashier {
  background: rgba(33, 150, 243, 0.18); /* azul --info */
  border: 1px solid var(--info);
  color: var(--info);
}

.mu-badge--waiter {
  background: rgba(76, 175, 80, 0.18); /* verde --success */
  border: 1px solid var(--success);
  color: var(--success);
}

.mu-badge--kitchen {
  background: rgba(158, 158, 158, 0.18); /* gris */
  border: 1px solid #9e9e9e;
  color: #bdbdbd;
}

/* Badge Activo/Inactivo (L504-536: verde/rojo alpha) */
.mu-status {
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.mu-status--active {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.mu-status--inactive {
  background: rgba(255, 82, 82, 0.15);
  color: var(--error);
}

.mu-item-sub {
  font-size: 13px;
  color: var(--text-muted); /* white70 (L548-554) */
}

.mu-item-email {
  font-size: 12px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Trailing: IconButtons (L558-610) */
.mu-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.mu-item-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.mu-item-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.mu-item-btn--delete {
  color: var(--error); /* Icon delete rojo (L599-601) */
}

.mu-item-btn--reactivate {
  color: var(--success);
}

.mu-item-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Confirm texto (L258-261) ===== */
.mu-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Form dentro del dialog ===== */
.mu-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mu-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mu-label {
  font-size: 12px;
  color: var(--text-faint);
}

.mu-input {
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

.mu-input:focus {
  border-color: var(--primary);
}

.mu-input[readonly] {
  opacity: 0.65;
  cursor: not-allowed;
}

/* Input con suffix (password) */
.mu-input-wrap {
  display: flex;
  align-items: center;
  padding: 0 6px 0 0;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s ease;
}

.mu-input-wrap:focus-within {
  border-color: var(--primary);
}

.mu-input--bare {
  border: none;
  background: transparent;
  flex: 1;
  min-width: 0;
}

.mu-eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  background: none;
  border: 0;
  border-radius: 8px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
}

.mu-eye:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

/* Fila de 2 columnas (Apepat/Apemat — Row L743-764) */
.mu-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* ===== Switch 'Estado activo' (mismo estilo que CreateUsersView) ===== */
.mu-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
  -webkit-user-select: none;
  user-select: none;
  align-self: flex-start;
}

.mu-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.mu-switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.15s ease;
}

.mu-switch-track::after {
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

.mu-switch input:checked + .mu-switch-track {
  background: var(--primary);
}

.mu-switch input:checked + .mu-switch-track::after {
  transform: translateX(18px);
  background: #ffffff;
}

.mu-switch input:focus-visible + .mu-switch-track {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.mu-switch-label {
  font-size: 15px;
  color: var(--text);
}

/* ===== PARTE C: pisos (L798-831) ===== */
.mu-floors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}

.mu-floors-title {
  font-size: 14px;
  font-weight: 700; /* L799-802: Text fontWeight bold */
  color: var(--text);
}

.mu-floors-state {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.mu-floors-error {
  margin: 0;
  font-size: 13px;
  color: var(--warning); /* discreto, NO bloqueante (brief) */
  word-break: break-word;
}

.mu-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* FilterChip réplica (L813-827): selected = deepOrange alpha + borde */
.mu-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.mu-chip--selected {
  background: rgba(255, 87, 34, 0.25);
  border-color: var(--primary);
  color: #ffffff;
}

.mu-floors-hint {
  font-size: 11px;
  color: var(--text-faint);
}

/* ===== Botones (ElevatedButton theme) ===== */
.mu-btn {
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

.mu-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.mu-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.mu-btn--danger {
  background: var(--error); /* TextButton rojo del confirm (L292) */
  color: #ffffff;
}

.mu-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.mu-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.mu-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.mu-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Responsive básico (móvil first) ===== */
@media (max-width: 560px) {
  .mu-appbar-title {
    font-size: 19px;
  }

  .mu-search-wrap {
    padding: 12px 12px 0;
  }

  .mu-list-wrap {
    padding: 12px;
  }

  .mu-card {
    flex-wrap: wrap;
    gap: 10px;
  }

  .mu-item-info {
    flex-basis: calc(100% - 66px);
  }

  .mu-item-actions {
    margin-left: 56px;
  }

  .mu-row {
    grid-template-columns: 1fr;
  }
}
</style>
