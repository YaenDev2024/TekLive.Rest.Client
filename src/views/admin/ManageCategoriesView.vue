<script setup lang="ts">
/**
 * ManageCategoriesView · "Catalogo de Categorías" (Fase 6.2) — réplica de
 * lib/screens/admin/create_categorias.dart (CrazyWings) con la estructura de
 * ManageCatalogView.vue (Fase 6.1): AppBar standalone + panel de alcance +
 * cards + AppModal dialogs + toasts.
 *
 * Estructura replicada del Flutter:
 * - AppBar (L12-19): back → admin-dashboard, título 'Catalogo de Categorías'
 *   (el original dice 'Crear Categoría'; el tile del dashboard dice
 *   'Catalogo de Categorías' — se usa el del tile, petición del brief).
 * - Form (L139-167): Card 'Alcance de la categoría' (L176) + ScopeSelector
 *   (L179-188) + TextField 'Nombre' (L153) + ElevatedButton 'Agregar' (L161).
 *   El scope del form PREFIJA solo el create (L104-106).
 * - Lista (L195-260): DataTable Nombre/Alcance/Acciones → aquí cards (móvil
 *   first) con nombre + badge de alcance (mismo estilo .mc-item-scope de
 *   ManageCatalogView) + editar (lápiz) + eliminar (papelera roja).
 * - _describeScope (L284-296): 'Piso #N' | 'Sucursal' | 'Global'.
 * - Dialog editar (L298-394): nombre + ScopeSelector precargado con el scope
 *   GUARDADO (L309-317: savedScopeType/savedPlantId de la categoría) +
 *   Cancelar/Guardar. Validación L357-362: nombre vacío → 'El nombre no puede
 *   estar vacío'.
 * - Confirm eliminar (L396-442): título 'Confirmar Eliminación', texto EXACTO
 *   '¿Estás seguro de eliminar la categoría "X"?', botones Cancelar/Eliminar
 *   (rojo L436).
 * - Validación submit (L93-100): PLANT sin piso → 'Selecciona un piso para el
 *   alcance'.
 * - Éxito → toast con el message del backend (réplica SnackBar content:
 *   Text(message) L109-112); aquí el envelope desenrollado no expone message
 *   per-endpoint, así que se usan textos réplica del flujo del original.
 *
 * Filtro por CONTEXTO DE ALCANCE del panel (misma semántica que
 * ManageCatalogView scopedItems): Global → solo GLOBAL; Sucursal → GLOBAL +
 * SUCURSAL; Piso N → GLOBAL + SUCURSAL + PLANT N. La carga es una sola (GET
 * sin plantId trae todo); el filtro es client-side.
 *
 * DESVIACIONES CONSCIENTES (mismas que ManageCatalogView):
 * - SnackBars del Flutter → toasts del sistema existente (useToastStore).
 * - DataTable del Flutter → cards (el usuario usa iPhone PWA: móvil first).
 * - Iconos lucide (LayoutGrid por defecto de categorías).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, LayoutGrid, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import ScopeSelector from '../../components/admin/ScopeSelector.vue'
import type { ScopeValue } from '../../components/admin/ScopeSelector.vue'
import { AppSpinner } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminCategoriesStore } from '../../stores/adminCategories'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { RestAdminCategory } from '../../api/rest'

const router = useRouter()
const store = useAdminCategoriesStore()
const toast = useToastStore()

// --- Guard de rol (mismo patrón que ManageCatalogView onMounted) ---------------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadCategories()
})

// --- goBack: back arrow del AppBar → admin-dashboard -----------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Form de creación (L139-167): alcance + nombre + 'Agregar' -------------------

/** Alcance de la NUEVA categoría (prefija nada más el create — L104-106). */
const scope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })
const nombre = ref('')
const creating = ref(false)

/** Submit del form 'Agregar' (réplica _submit L91-123). */
async function submitCreate(): Promise<void> {
  if (creating.value) return
  if (nombre.value.trim().length === 0) {
    toast.warning('El nombre no puede estar vacío') // réplica L357-362
    return
  }
  if (scope.value.scopeType === 'PLANT' && scope.value.plantId == null) {
    toast.warning('Selecciona un piso para el alcance') // réplica L93-100
    return
  }
  creating.value = true
  try {
    await store.createCategory({
      nombre: nombre.value.trim(),
      scopeType: scope.value.scopeType,
      sucursalId: POS_SUCURSAL_ID, // L105: auth.selectedSucursalId → constante
      plantId: scope.value.scopeType === 'PLANT' ? scope.value.plantId : null, // L106
    })
    toast.success('Categoría agregada exitosamente')
    nombre.value = '' // L113: _nombreController.clear()
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}` // L117-120 'Error: $e'
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    creating.value = false
  }
}

// --- Dialog editar (L298-394) ------------------------------------------------------

type DialogKind = 'none' | 'edit' | 'confirm'

const dialogKind = ref<DialogKind>('none')
const editingCategory = ref<RestAdminCategory | null>(null)
const editNombre = ref('')
/** Scope precargado con el scope GUARDADO (L309-317), editable en el dialog. */
const editScope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })
const saving = ref(false)
const deleting = ref(false)

/** Precarga el scope guardado de la categoría (L309-317 de scopes[0]). */
function savedScopeOf(category: RestAdminCategory): ScopeValue {
  const s = category.scopes?.[0]
  if (s == null) return { scopeType: 'GLOBAL', plantId: null }
  return {
    scopeType: s.scopeType,
    plantId: s.scopeType === 'PLANT' ? (s.plantId ?? null) : null,
  }
}

function openEdit(category: RestAdminCategory): void {
  editingCategory.value = category
  editNombre.value = category.nombre // L307: TextEditingController(text: name)
  editScope.value = savedScopeOf(category) // L309-317
  dialogKind.value = 'edit'
}

function openConfirm(category: RestAdminCategory): void {
  editingCategory.value = category
  dialogKind.value = 'confirm'
}

function closeDialog(): void {
  if (saving.value || deleting.value) return
  dialogKind.value = 'none'
  editingCategory.value = null
}

/** Guardar edición (réplica L356-389). */
async function submitEdit(): Promise<void> {
  if (editingCategory.value == null || saving.value) return
  if (editNombre.value.trim().length === 0) {
    toast.warning('El nombre no puede estar vacío') // L357-362
    return
  }
  if (editScope.value.scopeType === 'PLANT' && editScope.value.plantId == null) {
    toast.warning('Selecciona un piso para el alcance')
    return
  }
  saving.value = true
  try {
    await store.updateCategory(editingCategory.value.id, {
      nombre: editNombre.value.trim(),
      scopeType: editScope.value.scopeType,
      sucursalId: POS_SUCURSAL_ID, // L373-374
      plantId: editScope.value.scopeType === 'PLANT' ? editScope.value.plantId : null, // L375-377
    })
    toast.success('Categoría actualizada exitosamente') // L381: SnackBar(message)
    dialogKind.value = 'none'
    editingCategory.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}` // L383-386
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    saving.value = false
  }
}

/** Eliminar (soft) tras confirm (réplica L415-438). */
async function confirmDelete(): Promise<void> {
  if (editingCategory.value == null || deleting.value) return
  deleting.value = true
  try {
    await store.deleteCategory(editingCategory.value.id)
    toast.success('Categoría eliminada') // L422-424: SnackBar(message)
    dialogKind.value = 'none'
    editingCategory.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}` // L430-433
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deleting.value = false
  }
}

// --- Filtro por CONTEXTO DE ALCANCE del panel (mismo patrón ManageCatalog) --------

/**
 * Jerarquía de visibilidad (consistente con ManageCatalogView scopedItems):
 * GLOBAL → solo GLOBAL; SUCURSAL → GLOBAL + SUCURSAL; PLANT N → GLOBAL +
 * SUCURSAL + PLANT N. Categoría sin scopes (dato huérfano) siempre visible.
 */
const scopedCategories = computed(() => {
  const { scopeType, plantId } = scope.value
  return store.sortedCategories.filter((category) => {
    const scopes = category.scopes ?? []
    if (scopes.length === 0) return true // huérfano: visible en admin
    const hasGlobal = scopes.some((s) => s.scopeType === 'GLOBAL')
    const hasSucursal = scopes.some((s) => s.scopeType === 'SUCURSAL')
    const hasThisPlant = scopes.some((s) => s.scopeType === 'PLANT' && s.plantId === plantId)
    if (scopeType === 'GLOBAL') return hasGlobal
    if (scopeType === 'SUCURSAL') return hasGlobal || hasSucursal
    return hasGlobal || hasSucursal || hasThisPlant // PLANT
  })
})

/**
 * Badge de alcance — réplica _describeScope (L284-296): 'Piso #N' |
 * 'Sucursal' | 'Global'.
 */
function scopeBadge(category: RestAdminCategory): string {
  const s = category.scopes?.[0]
  if (s == null) return ''
  if (s.scopeType === 'PLANT') return s.plantId != null ? `Piso #${s.plantId}` : 'Piso'
  if (s.scopeType === 'SUCURSAL') return 'Sucursal'
  return 'Global'
}
</script>

<template>
  <div class="cat-page">
    <!-- ===== AppBar réplica: back + título + refresh ===== -->
    <header class="cat-appbar">
      <button
        type="button"
        class="cat-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="cat-back"
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
      <h1 class="cat-appbar-title">Catalogo de Categorías</h1>
      <div class="cat-appbar-actions">
        <button
          type="button"
          class="cat-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="cat-refresh"
          @click="store.loadCategories(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="cat-body">
      <!-- ===== Form crear (L139-167): card alcance + nombre + Agregar ===== -->
      <section class="cat-form-card" data-testid="cat-form">
        <h2 class="cat-form-title">Alcance de la categoría</h2>
        <ScopeSelector v-model="scope" />

        <div class="cat-field">
          <label class="cat-label" for="cat-nombre">Nombre</label>
          <input
            id="cat-nombre"
            v-model="nombre"
            type="text"
            class="cat-input"
            data-testid="cat-nombre"
            autocomplete="off"
            @keydown.enter.prevent="submitCreate"
          />
        </div>

        <button
          type="button"
          class="cat-btn cat-btn--primary cat-btn--block"
          data-testid="cat-add"
          :disabled="creating"
          @click="submitCreate"
        >
          <Plus :size="20" aria-hidden="true" />
          Agregar
        </button>
      </section>

      <!-- ===== Lista (L195-260): spinner / error / vacío / cards ===== -->
      <div class="cat-list-wrap">
        <div v-if="store.loading" class="cat-state" data-testid="cat-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="store.error != null" class="cat-state" data-testid="cat-error">
          <CircleAlert :size="64" class="cat-state-error-icon" aria-hidden="true" />
          <p class="cat-state-text">{{ store.error }}</p>
          <button
            type="button"
            class="cat-retry"
            data-testid="cat-retry"
            @click="store.loadCategories(true)"
          >
            Reintentar
          </button>
        </div>

        <p v-else-if="scopedCategories.length === 0" class="cat-state cat-empty" data-testid="cat-empty">
          No hay categorías para mostrar
        </p>

        <ul v-else class="cat-list" data-testid="cat-list">
          <li
            v-for="category in scopedCategories"
            :key="category.id"
            class="cat-card"
            :data-testid="`cat-item-${category.id}`"
          >
            <span class="cat-avatar">
              <LayoutGrid :size="22" aria-hidden="true" />
            </span>
            <span class="cat-item-info">
              <span class="cat-item-name">{{ category.nombre }}</span>
              <span class="cat-item-meta">
                <span v-if="scopeBadge(category) !== ''" class="cat-item-scope">
                  {{ scopeBadge(category) }}
                </span>
              </span>
            </span>
            <span class="cat-item-actions">
              <button
                type="button"
                class="cat-item-btn"
                :aria-label="`Editar ${category.nombre}`"
                :data-testid="`cat-edit-${category.id}`"
                @click="openEdit(category)"
              >
                <Pencil :size="20" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="cat-item-btn cat-item-btn--delete"
                :aria-label="`Eliminar ${category.nombre}`"
                :data-testid="`cat-delete-${category.id}`"
                @click="openConfirm(category)"
              >
                <Trash2 :size="20" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </main>

    <!-- ===== Dialog editar (L298-394) ===== -->
    <AppModal
      v-if="dialogKind === 'edit' && editingCategory != null"
      title="Editar Categoría"
      :width="440"
      data-testid="cat-edit-dialog"
      @close="closeDialog"
    >
      <form class="cat-form" @submit.prevent="submitEdit">
        <div class="cat-field">
          <label class="cat-label" for="cat-edit-nombre">Nombre</label>
          <input
            id="cat-edit-nombre"
            v-model="editNombre"
            type="text"
            class="cat-input"
            data-testid="cat-edit-nombre"
            autocomplete="off"
          />
        </div>
        <!-- ScopeSelector precargado con el scope GUARDADO (L337-346) -->
        <div class="cat-field">
          <ScopeSelector v-model="editScope" />
        </div>
      </form>
      <template #footer>
        <button
          type="button"
          class="cat-btn cat-btn--ghost"
          data-testid="cat-edit-cancel"
          :disabled="saving"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="cat-btn cat-btn--primary"
          data-testid="cat-edit-save"
          :disabled="saving"
          @click="submitEdit"
        >
          Guardar
        </button>
      </template>
    </AppModal>

    <!-- ===== Confirm eliminar (L396-442): texto EXACTO del Flutter ===== -->
    <AppModal
      v-if="dialogKind === 'confirm' && editingCategory != null"
      title="Confirmar Eliminación"
      :width="400"
      @close="closeDialog"
    >
      <p class="cat-confirm-text" data-testid="cat-confirm-text">
        ¿Estás seguro de eliminar la categoría "{{ editingCategory.nombre }}"?
      </p>
      <template #footer>
        <button
          type="button"
          class="cat-btn cat-btn--ghost"
          data-testid="cat-confirm-cancel"
          :disabled="deleting"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="cat-btn cat-btn--danger"
          data-testid="cat-confirm-ok"
          :disabled="deleting"
          @click="confirmDelete"
        >
          Eliminar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen standalone (mismo layout que
   ManageCatalogView: var(--bg), sin rail). */
.cat-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, refresh a la derecha ===== */
.cat-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.cat-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.cat-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 (patrón ManageCatalogView) */
.cat-icon-btn {
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

.cat-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado (máx ~800px como ManageCatalogView) ===== */
.cat-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== Form card (L169-193: Card + Padding 12, título bold) ===== */
.cat-form-card {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid var(--border); /* Colors.grey.shade700 */
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cat-form-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700; /* TextStyle(fontWeight: FontWeight.bold) L176 */
  color: var(--text);
}

.cat-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* labelText: labelStyle grey[400] (main L114) */
.cat-label {
  font-size: 12px;
  color: var(--text-faint);
}

/* InputDecorationTheme réplica: fill black alpha .3, outline grey[700]
   radius 12, focused deepOrange (main L113-125) */
.cat-input {
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

.cat-input:focus {
  border-color: var(--primary);
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.cat-btn {
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

/* ElevatedButton L155-161: padding vertical 16, fontSize 18 */
.cat-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.cat-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.cat-btn--block {
  padding-top: 16px;
  padding-bottom: 16px;
  font-size: 18px;
}

.cat-btn--danger {
  background: var(--error); /* ElevatedButton rojo del confirm (L436) */
  color: #ffffff;
}

.cat-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.cat-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted); /* TextButton */
}

.cat-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.cat-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Lista: Expanded + ListView padding 16 ===== */
.cat-list-wrap {
  flex: 1;
  padding: 16px;
}

.cat-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.cat-empty {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.cat-state-error-icon {
  color: var(--error); /* Icons.error_outline rojo */
}

.cat-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar': deepOrange radius 12 bold */
.cat-retry {
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

.cat-retry:hover {
  background: var(--primary-hover);
}

/* ===== Card de categoría (CardTheme grey[850] elev 2 radius 12) ===== */
.cat-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* CircleAvatar (Icons.edit azul / delete rojo en el original: aquí avatar
   uniforme + acciones como ManageCatalogView) */
.cat-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.22); /* deepOrange alpha (categoría) */
  color: var(--primary);
}

.cat-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cat-item-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-item-meta {
  display: flex;
  align-items: center;
}

/* Badge de alcance (mismo estilo .mc-item-scope de ManageCatalogView) */
.cat-item-scope {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  font-size: 11px;
}

/* Trailing: IconButtons editar/eliminar (L239-250) */
.cat-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.cat-item-btn {
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

.cat-item-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.cat-item-btn--delete {
  color: var(--error); /* Icon delete rojo (L245) */
}

/* ===== Confirm texto (L409) ===== */
.cat-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Form dentro del dialog ===== */
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== Responsive básico: móvil reduce paddings (mismo patrón MC) ===== */
@media (max-width: 560px) {
  .cat-appbar-title {
    font-size: 19px;
  }

  .cat-form-card {
    margin: 8px 12px 0;
  }

  .cat-list-wrap {
    padding: 12px;
  }

  .cat-card {
    flex-wrap: wrap;
    gap: 10px;
  }

  .cat-item-info {
    flex-basis: calc(100% - 66px);
  }

  .cat-item-actions {
    margin-left: 56px;
  }
}
</style>
