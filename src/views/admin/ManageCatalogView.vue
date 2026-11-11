<script setup lang="ts">
/**
 * ManageCatalogView · "Gestionar Catálogo" (Fase 6.1) — réplica EXACTA de
 * lib/screens/admin/manage_catalog_screen.dart (CrazyWings).
 *
 * Gestiona el pool de catalog_items = OPCIONES del wizard del POS (SALSA,
 * PROTEINA, COMPLEMENTO, EXTRA, BEBIDA, MODIFICADOR — p.ej. "Barbacoa",
 * "Tortilla de maíz", "Hielo extra"). NO son los productos del menú.
 *
 * Estructura replicada:
 * - Scaffold + AppBar (L435-450): back arrow → admin-dashboard (el original
 *   es una ruta push; aquí standalone full-screen como AdminDashboardView,
 *   sin rail), título 'Gestionar Catálogo', acciones '+' (tooltip 'Agregar
 *   Item') y refresh (tooltip 'Recargar').
 * - Panel 'Contexto de alcance' (L453-482): container margin 16/12/16/0,
 *   padding 12, borde grey[700] radius 10, título bold + ScopeSelector.
 *   SEMÁNTICA (petición beta 2026-11-11): el scope PREFIJA los dialogs de
 *   crear/editar (L104-105 y L248-249) Y TAMBIÉN FILTRA la lista
 *   (scopedItems): Global → solo GLOBAL; Sucursal → GLOBAL + SUCURSAL;
 *   Piso N → GLOBAL + SUCURSAL + PLANT N (jerarquía de herencia, items de
 *   OTROS pisos no aplican). La CARGA sigue siendo una sola (GET sin
 *   plantId trae todo — el backend ya incluye items PLANT en el listado
 *   admin, fix 2cafb87); el filtro por alcance es client-side en la vista.
 * - Buscador (L484-513): TextField 'Buscar item...' con lupa (prefix) y X
 *   de clear (suffix, solo con texto), fill surface, radius 8. Filtra
 *   client-side nombre/descripcion case-insensitive (_applyFilter L79-84,
 *   vive en stores/adminCatalog.ts).
 * - Chips de tipo (L515-539): FilterChips horizontales scrollables con los
 *   7 valores de _tipos (L27-35); seleccionado = chip primario.
 * - Lista (L542-616): cards con avatar circular verde/gris según activo
 *   (L572: Colors.green : Colors.grey) + icono por tipo (_getIconForType
 *   L622-639), título bold TACHADO si inactivo (L578-583), subtítulo
 *   '{TIPO} • $X.XX' (L588) + descripción 1 línea elipsis (L589-595),
 *   trailing: editar (lápiz, L601-604) + eliminar (papelera roja, L605-610
 *   → _deleteItem = SOFT delete).
 * - Dialogs crear (L98-239) y editar (L241-392): mismo form (Tipo dropdown
 *   SIN 'TODOS' L122-125, ScopeSelector L131-140, Nombre* L142-148,
 *   Descripción 2 líneas L150-157, Precio con FilteringTextInputFormatter
 *   allow(RegExp(r'^\d+\.?\d{0,2}')) L162-164 + prefix '$', Cantidad
 *   Disponible digitsOnly L174-175 + hint '999 = ilimitado' L179); editar
 *   añade switch 'Activo' (L326-332). Validaciones L192-204: nombre vacío →
 *   'El nombre es requerido'; PLANT sin piso → 'Selecciona un piso para
 *   alcance por piso'. Éxito → 'Item creado exitosamente' (L221) /
 *   'Item actualizado exitosamente' (L374); error → 'Error: $e' (L228/L381).
 * - Confirm de desactivación (L394-412): título 'Desactivar Item', texto
 *   EXACTO '¿Desea desactivar "X"? El item no se eliminará, solo se
 *   ocultará.', botón rojo 'Desactivar'. Éxito → 'Item desactivado' (L419).
 * - Estados del cuerpo (L542-562): spinner centrado / error (icono rojo 64
 *   + mensaje + botón 'Reintentar') / vacío 'No hay items en el catálogo'.
 *
 * DESVIACIONES CONSCIENTES (iconos lucide — el original usa Material Icons):
 * - SALSA Icons.water_drop → Droplets, PROTEINA Icons.restaurant → Utensils,
 *   COMPLEMENTO Icons.fastfood → Pizza, EXTRA Icons.add_circle_outline →
 *   CirclePlus, BEBIDA Icons.local_drink → CupSoda, MODIFICADOR
 *   Icons.tune → SlidersHorizontal, default Icons.category → Package.
 * - Switch 'Activo' del dialog editar → checkbox estilizado (mismo papel:
 *   envía activo en el PUT).
 * - SnackBars del Flutter → toasts del sistema existente (ToastHost).
 * - El teclado virtual global funciona en los inputs del dialog
 *   (AutoKeyboardWrapper abre el teclado al enfocar cualquier input — sin
 *   data-vk-ignore). Precio/Cantidad usan inputmode decimal/numeric
 *   (layout numérico) + sanitización en el evento input (equivalente al
 *   FilteringTextInputFormatter del Flutter).
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  CircleAlert,
  CirclePlus,
  CupSoda,
  Droplets,
  Package,
  Pencil,
  Plus,
  Pizza,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Utensils,
  X,
  type LucideProps,
} from 'lucide-vue-next'
import type { FunctionalComponent } from 'vue'
import AppModal from '../../components/pos/AppModal.vue'
import ScopeSelector from '../../components/admin/ScopeSelector.vue'
import type { ScopeValue } from '../../components/admin/ScopeSelector.vue'
import { AppSpinner, AppSelect } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminCatalogStore, CATALOG_ITEM_TIPOS } from '../../stores/adminCatalog'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { CatalogScopeType, RestAdminCatalogItem } from '../../api/rest'

const router = useRouter()
const store = useAdminCatalogStore()
const toast = useToastStore()

// --- Guard de rol (mismo patrón que AdminDashboardView onMounted) ---------------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadItems()
})

// --- goBack: back arrow del AppBar → admin-dashboard -----------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Contexto de alcance (L24-25 + L453-482): SOLO prefija los dialogs -----------

const scope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })

// --- Iconos por tipo (_getIconForType L622-639, desviación lucide) ---------------

const TYPE_ICONS: Record<string, FunctionalComponent<LucideProps>> = {
  SALSA: Droplets,
  PROTEINA: Utensils,
  COMPLEMENTO: Pizza,
  EXTRA: CirclePlus,
  BEBIDA: CupSoda,
  MODIFICADOR: SlidersHorizontal,
}

/** Default Icons.category (L636-637) → Package. */
function iconForType(tipo: string): FunctionalComponent<LucideProps> {
  return TYPE_ICONS[tipo] ?? Package
}

// --- Dialog state -----------------------------------------------------------------

type DialogKind = 'none' | 'create' | 'edit' | 'confirm'

interface ItemForm {
  tipo: string
  nombre: string
  descripcion: string
  precio: string
  cantidad: string
  activo: boolean
}

function emptyForm(): ItemForm {
  return {
    tipo: 'SALSA', // L103: default 'SALSA'
    nombre: '',
    descripcion: '',
    precio: '0.00', // L101
    cantidad: '999', // L102
    activo: true,
  }
}

const dialogKind = ref<DialogKind>('none')
const editingItem = ref<RestAdminCatalogItem | null>(null)
const form = reactive<ItemForm>(emptyForm())
/** Scope prefijado del panel al abrir el dialog (L104-105 / L248-249). */
const formScope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })
const submitting = ref(false)
const deactivating = ref(false)

const isCreate = computed(() => dialogKind.value === 'create')
const isEdit = computed(() => dialogKind.value === 'edit')
const dialogTitle = computed(() =>
  isCreate.value ? 'Agregar Item al Catálogo' : 'Editar Item',
) // L111 / L255

/** Abre el dialog crear (L98-106): scope prefijado del panel. */
function openCreate(): void {
  Object.assign(form, emptyForm())
  formScope.value = { scopeType: scope.value.scopeType, plantId: scope.value.plantId }
  dialogKind.value = 'create'
}

/** Abre el dialog editar prellenado (L241-249). */
function openEdit(item: RestAdminCatalogItem): void {
  editingItem.value = item
  Object.assign(form, {
    tipo: item.tipo,
    nombre: item.nombre,
    descripcion: item.descripcion ?? '',
    precio: item.precio.toFixed(2), // L244 toStringAsFixed(2)
    cantidad: String(item.cantidadDisponible), // L245
    activo: item.activo,
  })
  // L248-249: el scope inicial del dialog es el del PANEL, no el del item.
  formScope.value = { scopeType: scope.value.scopeType, plantId: scope.value.plantId }
  dialogKind.value = 'edit'
}

function closeDialog(): void {
  if (submitting.value || deactivating.value) return
  dialogKind.value = 'none'
  editingItem.value = null
}

/** Confirm de desactivación (L394-412). */
function openConfirm(item: RestAdminCatalogItem): void {
  editingItem.value = item
  dialogKind.value = 'confirm'
}

// --- Sanitización réplica de los FilteringTextInputFormatter ---------------------

/** Precio L162-164: allow(RegExp(r'^\d+\.?\d{0,2}')). */
function sanitizePrecio(): void {
  const cleaned = form.precio.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  form.precio =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

/** Cantidad L175: digitsOnly. */
function sanitizeCantidad(): void {
  form.cantidad = form.cantidad.replace(/\D/g, '')
}

// --- Submit crear/editar (L191-232 / L342-385) ------------------------------------

function validateForm(): boolean {
  if (form.nombre.trim().length === 0) {
    toast.warning('El nombre es requerido') // L192-197
    return false
  }
  if (formScope.value.scopeType === 'PLANT' && formScope.value.plantId == null) {
    toast.warning('Selecciona un piso para alcance por piso') // L199-204
    return false
  }
  return true
}

function buildPayload(): {
  nombre: string
  descripcion: string | null
  tipo: string
  precio: number
  cantidadDisponible: number
  scopeType: CatalogScopeType
  sucursalId: number
  plantId: number | null
} {
  const descripcion = form.descripcion.trim()
  return {
    nombre: form.nombre.trim(), // L208
    descripcion: descripcion.length === 0 ? null : descripcion, // L209
    tipo: form.tipo, // L210
    precio: Number.parseFloat(form.precio) || 0.0, // L211 double.tryParse ?? 0.0
    cantidadDisponible: Number.parseInt(form.cantidad, 10) || 999, // L212 ?? 999
    scopeType: formScope.value.scopeType, // L213
    sucursalId: POS_SUCURSAL_ID, // L214 (auth.selectedSucursalId → constante del repo)
    plantId: formScope.value.scopeType === 'PLANT' ? formScope.value.plantId : null, // L215
  }
}

async function submitForm(): Promise<void> {
  if (!validateForm() || submitting.value) return
  submitting.value = true
  try {
    if (isCreate.value) {
      await store.createItem(buildPayload())
      toast.success('Item creado exitosamente') // L221
    } else if (editingItem.value != null) {
      await store.updateItem(editingItem.value.id, {
        ...buildPayload(),
        activo: form.activo, // L365 (switch del dialog editar)
      })
      toast.success('Item actualizado exitosamente') // L374
    }
    dialogKind.value = 'none'
    editingItem.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}` // L228/L381 'Error: $e'
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    submitting.value = false
  }
}

// --- Desactivación soft (L394-431) -------------------------------------------------

async function confirmDeactivate(): Promise<void> {
  if (editingItem.value == null || deactivating.value) return
  deactivating.value = true
  try {
    await store.deactivateItem(editingItem.value.id)
    toast.success('Item desactivado') // L419
    dialogKind.value = 'none'
    editingItem.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}` // L426
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deactivating.value = false
  }
}

// --- Buscador (L484-513) -----------------------------------------------------------

/** L506-510: onChanged → _searchQuery + _applyFilter (el store lo computa). */
function onSearchInput(event: Event): void {
  store.searchQuery = (event.target as HTMLInputElement).value
}

/** L491-500: suffix clear (solo visible con texto). */
function clearSearch(): void {
  store.searchQuery = ''
}

const hasSearch = computed(() => store.searchQuery.length > 0)

/**
 * Filtro de lista por CONTEXTO DE ALCANCE del panel (petición beta:
 * "aunque ponga piso específico y piso 2 no quiero ver el item de piso 1").
 *
 * Jerarquía de visibilidad (consistente con cómo el backend resuelve el
 * menú del POS por (sucursal, piso)):
 * - GLOBAL → solo items con scope GLOBAL.
 * - SUCURSAL → GLOBAL + SUCURSAL (los pisos son de la empresa, no de una
 *   sucursal — un item de piso no "cuelga" de ninguna sucursal).
 * - PLANT N → GLOBAL + SUCURSAL + PLANT N (un piso hereda lo global y lo
 *   de sucursal; items de OTROS pisos no aplican).
 *
 * Item sin scopes (dato huérfano) siempre visible en admin (como antes).
 */
const scopedItems = computed(() => {
  const { scopeType, plantId } = scope.value
  return store.filteredItems.filter((item) => {
    const scopes = item.scopes ?? []
    if (scopes.length === 0) return true // huérfano: visible en admin
    const hasGlobal = scopes.some((s) => s.scopeType === 'GLOBAL')
    const hasSucursal = scopes.some((s) => s.scopeType === 'SUCURSAL')
    const hasThisPlant = scopes.some((s) => s.scopeType === 'PLANT' && s.plantId === plantId)
    if (scopeType === 'GLOBAL') return hasGlobal
    if (scopeType === 'SUCURSAL') return hasGlobal || hasSucursal
    return hasGlobal || hasSucursal || hasThisPlant // PLANT
  })
})

/** Badge de alcance del item: primera letra del scope + piso si aplica. */
function scopeBadge(item: RestAdminCatalogItem): string {
  const s = item.scopes?.[0]
  if (s == null) return ''
  if (s.scopeType === 'PLANT') return `Piso ${s.plantId ?? '?'}`
  if (s.scopeType === 'SUCURSAL') return 'Sucursal'
  return 'Global'
}
</script>

<template>
  <div class="mc-page">
    <!-- ===== AppBar réplica L435-450: back + título + '+' + refresh ===== -->
    <header class="mc-appbar">
      <button
        type="button"
        class="mc-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="mc-back"
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
      <h1 class="mc-appbar-title">Gestionar Catálogo</h1>
      <div class="mc-appbar-actions">
        <button
          type="button"
          class="mc-icon-btn"
          title="Agregar Item"
          aria-label="Agregar Item"
          data-testid="mc-add"
          @click="openCreate"
        >
          <Plus :size="24" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="mc-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="mc-refresh"
          @click="store.loadItems(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="mc-body">
      <!-- ===== Panel 'Contexto de alcance' (L453-482): SOLO prefija dialogs ===== -->
      <section class="mc-scope-panel" data-testid="mc-scope-panel">
        <h2 class="mc-scope-title">Contexto de alcance</h2>
        <ScopeSelector v-model="scope" />
      </section>

      <!-- ===== Buscador (L484-513) ===== -->
      <div class="mc-search-wrap">
        <div class="mc-search">
          <Search :size="20" class="mc-search-icon" aria-hidden="true" />
          <input
            type="text"
            class="mc-search-input"
            placeholder="Buscar item..."
            aria-label="Buscar item"
            data-testid="mc-search"
            :value="store.searchQuery"
            @input="onSearchInput"
          />
          <button
            v-if="hasSearch"
            type="button"
            class="mc-search-clear"
            aria-label="Limpiar búsqueda"
            data-testid="mc-search-clear"
            @click="clearSearch"
          >
            <X :size="18" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- ===== Chips de tipo (L515-539): FilterChips horizontales ===== -->
      <nav class="mc-chips-wrap" aria-label="Filtrar por tipo">
        <div class="mc-chips" role="tablist">
          <button
            v-for="tipo in CATALOG_ITEM_TIPOS"
            :key="tipo"
            type="button"
            role="tab"
            class="mc-chip"
            :class="{ 'mc-chip--active': store.selectedFilter === tipo }"
            :aria-selected="store.selectedFilter === tipo"
            :data-testid="`mc-chip-${tipo.toLowerCase()}`"
            @click="store.selectedFilter = tipo"
          >
            {{ tipo }}
          </button>
        </div>
      </nav>

      <!-- ===== Lista (L542-616): spinner / error / vacío / cards ===== -->
      <div class="mc-list-wrap">
        <div v-if="store.loading" class="mc-state" data-testid="mc-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="store.error != null" class="mc-state" data-testid="mc-error">
          <CircleAlert :size="64" class="mc-state-error-icon" aria-hidden="true" />
          <p class="mc-state-text">{{ store.error }}</p>
          <button
            type="button"
            class="mc-retry"
            data-testid="mc-retry"
            @click="store.loadItems(true)"
          >
            Reintentar
          </button>
        </div>

        <p v-else-if="scopedItems.length === 0" class="mc-state mc-empty" data-testid="mc-empty">
          No hay items para el alcance seleccionado
        </p>

        <ul v-else class="mc-list" data-testid="mc-list">
          <li
            v-for="item in scopedItems"
            :key="item.id"
            class="mc-card"
            :data-testid="`mc-item-${item.id}`"
          >
            <!-- Avatar circular verde/gris según activo (L571-577) -->
            <span class="mc-avatar" :class="{ 'mc-avatar--inactive': !item.activo }">
              <component :is="iconForType(item.tipo)" :size="22" aria-hidden="true" />
            </span>
            <span class="mc-item-info">
              <!-- Título bold TACHADO si inactivo (L578-583) -->
              <span class="mc-item-name" :class="{ 'mc-item-name--inactive': !item.activo }">
                {{ item.nombre }}
              </span>
              <!-- Subtítulo '{TIPO} • $X.XX' + badge de alcance -->
              <span class="mc-item-tipo">
                {{ item.tipo }} • ${{ item.precio.toFixed(2) }}
                <span v-if="scopeBadge(item) !== ''" class="mc-item-scope">
                  {{ scopeBadge(item) }}
                </span>
              </span>
              <!-- Descripción 1 línea elipsis (L589-595) -->
              <span
                v-if="item.descripcion != null && item.descripcion.length > 0"
                class="mc-item-desc"
              >
                {{ item.descripcion }}
              </span>
            </span>
            <!-- Trailing: editar + eliminar (L598-611) -->
            <span class="mc-item-actions">
              <button
                type="button"
                class="mc-item-btn"
                :aria-label="`Editar ${item.nombre}`"
                :data-testid="`mc-edit-${item.id}`"
                @click="openEdit(item)"
              >
                <Pencil :size="20" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="mc-item-btn mc-item-btn--delete"
                :aria-label="`Desactivar ${item.nombre}`"
                :data-testid="`mc-delete-${item.id}`"
                @click="openConfirm(item)"
              >
                <Trash2 :size="20" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </main>

    <!-- ===== Dialog crear/editar (L98-239 / L241-392) ===== -->
    <AppModal
      v-if="isCreate || isEdit"
      :title="dialogTitle"
      :width="440"
      data-testid="mc-dialog"
      @close="closeDialog"
    >
      <form class="mc-form" @submit.prevent="submitForm">
        <!-- Tipo dropdown SIN 'TODOS' (L116-129) — AppSelect propio (picker
             nativo de iOS PWA no confirma la opción tocada) -->
        <div class="mc-field">
          <label class="mc-label" for="mc-f-tipo">Tipo</label>
          <AppSelect
            v-model="form.tipo"
            :options="CATALOG_ITEM_TIPOS.filter((t) => t !== 'TODOS').map((t) => ({ value: t, label: t }))"
            testid="mc-f-tipo"
            aria-label="Tipo"
          />
        </div>

        <!-- ScopeSelector (L131-140) -->
        <div class="mc-field">
          <ScopeSelector v-model="formScope" />
        </div>

        <!-- Nombre * (L142-148) -->
        <div class="mc-field">
          <label class="mc-label" for="mc-f-nombre">Nombre *</label>
          <input
            id="mc-f-nombre"
            v-model="form.nombre"
            type="text"
            class="mc-input"
            data-testid="mc-f-nombre"
            autocomplete="off"
          />
        </div>

        <!-- Descripción 2 líneas (L150-157) -->
        <div class="mc-field">
          <label class="mc-label" for="mc-f-desc">Descripción</label>
          <textarea
            id="mc-f-desc"
            v-model="form.descripcion"
            class="mc-input mc-textarea"
            rows="2"
            data-testid="mc-f-desc"
          ></textarea>
        </div>

        <!-- Precio (L159-170): FilteringTextInputFormatter + prefix '$' -->
        <div class="mc-field">
          <label class="mc-label" for="mc-f-precio">Precio</label>
          <div class="mc-input-wrap">
            <span class="mc-prefix">$</span>
            <input
              id="mc-f-precio"
              v-model="form.precio"
              type="text"
              inputmode="decimal"
              class="mc-input mc-input--prefixed"
              data-testid="mc-f-precio"
              @input="sanitizePrecio"
            />
          </div>
        </div>

        <!-- Cantidad Disponible (L172-181): digitsOnly + hint '999 = ilimitado' -->
        <div class="mc-field">
          <label class="mc-label" for="mc-f-cantidad">Cantidad Disponible</label>
          <input
            id="mc-f-cantidad"
            v-model="form.cantidad"
            type="text"
            inputmode="numeric"
            class="mc-input"
            placeholder="999 = ilimitado"
            data-testid="mc-f-cantidad"
            @input="sanitizeCantidad"
          />
        </div>

        <!-- Switch Activo SOLO en editar (L326-332) -->
        <label v-if="isEdit" class="mc-switch" data-testid="mc-f-activo">
          <input v-model="form.activo" type="checkbox" />
          <span class="mc-switch-track" aria-hidden="true"></span>
          <span class="mc-switch-label">Activo</span>
        </label>
      </form>
      <template #footer>
        <button
          type="button"
          class="mc-btn mc-btn--ghost"
          data-testid="mc-cancel"
          :disabled="submitting"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="mc-btn mc-btn--primary"
          data-testid="mc-submit"
          :disabled="submitting"
          @click="submitForm"
        >
          {{ isCreate ? 'Crear' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <!-- ===== Confirm de desactivación (L394-412) ===== -->
    <AppModal v-if="dialogKind === 'confirm' && editingItem != null" title="Desactivar Item" :width="400" @close="closeDialog">
      <p class="mc-confirm-text" data-testid="mc-confirm-text">
        ¿Desea desactivar "{{ editingItem.nombre }}"? El item no se eliminará, solo se ocultará.
      </p>
      <template #footer>
        <button
          type="button"
          class="mc-btn mc-btn--ghost"
          data-testid="mc-confirm-cancel"
          :disabled="deactivating"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="mc-btn mc-btn--danger"
          data-testid="mc-confirm-ok"
          :disabled="deactivating"
          @click="confirmDeactivate"
        >
          Desactivar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen standalone (L435; mismo layout que
   AdminDashboardView: var(--bg), sin rail). */
.mc-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar (L435-450): bg scaffold, elevation 0, acciones a la derecha ===== */
.mc-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.mc-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.mc-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 (patrón AdminDashboardView) */
.mc-icon-btn {
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

.mc-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado (máx ~800px como el original móvil/desktop) ===== */
.mc-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== Panel 'Contexto de alcance' (L453-482): margin 16/12/16/0, padding 12,
   borde grey[700] radius 10 ===== */
.mc-scope-panel {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid var(--border); /* Colors.grey.shade700 */
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px; /* SizedBox(height: 8) L464 */
}

.mc-scope-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700; /* TextStyle(fontWeight: FontWeight.bold) L463 */
  color: var(--text);
}

/* ===== Buscador (L484-513): container bg surface, padding 16/12 ===== */
.mc-search-wrap {
  padding: 12px 16px;
  background: var(--bg-surface); /* Theme.colorScheme.surface grey[850] */
}

.mc-search {
  position: relative;
}

.mc-search-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

/* TextField OutlineInputBorder radius 8 (L502-504), fill del tema
   (black alpha .3 sobre surface → se ve oscuro) */
.mc-search-input {
  width: 100%;
  height: 44px;
  padding: 0 40px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s ease;
}

.mc-search-input::placeholder {
  color: var(--text-faint);
}

.mc-search-input:focus {
  border-color: var(--primary); /* focusedBorder deepOrange (main L121-125) */
}

.mc-search-clear {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-faint);
  cursor: pointer;
}

.mc-search-clear:hover {
  color: var(--text);
}

/* ===== Chips (L515-539): horizontal scroll, padding 16 ===== */
.mc-chips-wrap {
  background: var(--bg-surface);
  padding: 0 16px 4px;
  overflow-x: auto;
}

.mc-chips {
  display: flex;
  gap: 8px; /* Padding(right: 8) L524 */
  padding: 12px 0;
  width: max-content;
}

/* FilterChip réplica: selected = fill primary alpha + borde primary + texto
   primary; unselected = outline grey y texto blanco. */
.mc-chip {
  flex: none;
  padding: 7px 14px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.mc-chip:hover {
  border-color: var(--text-faint);
}

.mc-chip--active {
  background: rgba(255, 87, 34, 0.22); /* selected fill deepOrange alpha */
  border-color: var(--primary);
  color: var(--primary);
}

/* ===== Lista (L542-616): Expanded + ListView padding 16 ===== */
.mc-list-wrap {
  flex: 1;
  padding: 16px;
}

.mc-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.mc-empty {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.mc-state-error-icon {
  color: var(--error); /* Icons.error_outline rojo (L550) */
}

.mc-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar' (L554-557): deepOrange radius 12 bold */
.mc-retry {
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

.mc-retry:hover {
  background: var(--primary-hover);
}

/* ===== Card de item (CardTheme grey[850] elev 2 radius 12) + ListTile ===== */
.mc-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px; /* margin bottom 12 (L569) */
}

.mc-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow); /* elevation 2 CardTheme */
}

/* CircleAvatar verde/gris según activo (L571-577) */
.mc-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: var(--success); /* Colors.green */
  color: #ffffff;
}

.mc-avatar--inactive {
  background: #9e9e9e; /* Colors.grey */
}

/* Título + subtítulo (ListTile title/subtitle, L578-596) */
.mc-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mc-item-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mc-item-name--inactive {
  text-decoration: line-through; /* TextDecoration.lineThrough (L582) */
}

.mc-item-tipo {
  font-size: 13px;
  color: var(--text-muted);
}

/* Badge de alcance del item (Global / Sucursal / Piso N). */
.mc-item-scope {
  margin-left: 6px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  font-size: 11px;
}

.mc-item-desc {
  font-size: 12px;
  color: #bdbdbd; /* Colors.grey[400] (L592) */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Trailing: IconButtons editar/eliminar (L598-611) */
.mc-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.mc-item-btn {
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

.mc-item-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.mc-item-btn--delete {
  color: var(--error); /* Icon delete_outline color rojo (L607) */
}

/* ===== Dialog form ===== */
.mc-form {
  display: flex;
  flex-direction: column;
  gap: 12px; /* SizedBox(height: 12) entre campos */
}

.mc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* labelText: labelStyle grey[400] (main L114) */
.mc-label {
  font-size: 12px;
  color: var(--text-faint);
}

.mc-input-wrap {
  position: relative;
}

.mc-prefix {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

/* InputDecorationTheme réplica: fill black alpha .3, outline grey[700]
   radius 12, focused deepOrange (main L113-125) */
.mc-input,
.mc-select {
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

.mc-input--prefixed {
  padding-left: 30px;
}

.mc-textarea {
  height: auto;
  min-height: 68px;
  padding: 10px 12px;
  resize: vertical;
}

.mc-input:focus,
.mc-select:focus {
  border-color: var(--primary);
}

.mc-input::placeholder {
  color: var(--text-faint);
}

.mc-select-wrap {
  position: relative;
}

.mc-select {
  appearance: none;
  cursor: pointer;
}

.mc-select option {
  background: var(--bg-surface);
  color: var(--text);
}

/* Switch 'Activo' (L326-332): SwitchListTile → checkbox estilizado */
.mc-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
  -webkit-user-select: none;
  user-select: none;
}

.mc-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.mc-switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25); /* unselected track */
  transition: background 0.15s ease;
}

.mc-switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #bdbdbd; /* unselected thumb */
  transition: transform 0.15s ease, background 0.15s ease;
}

.mc-switch input:checked + .mc-switch-track {
  background: var(--primary); /* selected track deepOrange */
}

.mc-switch input:checked + .mc-switch-track::after {
  transform: translateX(18px);
  background: #ffffff;
}

.mc-switch input:focus-visible + .mc-switch-track {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.mc-switch-label {
  font-size: 15px;
  color: var(--text);
}

/* ===== Confirm texto (L399) ===== */
.mc-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.mc-btn {
  padding: 12px 24px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.mc-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.mc-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.mc-btn--danger {
  background: var(--error); /* ElevatedButton rojo del confirm (L406) */
  color: #ffffff;
}

.mc-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.mc-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted); /* TextButton */
}

.mc-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.mc-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Responsive básico: móvil apila acciones y reduce paddings ===== */
@media (max-width: 560px) {
  .mc-appbar-title {
    font-size: 19px;
  }

  .mc-scope-panel {
    margin: 8px 12px 0;
  }

  .mc-search-wrap,
  .mc-chips-wrap,
  .mc-list-wrap {
    padding-left: 12px;
    padding-right: 12px;
  }

  .mc-card {
    flex-wrap: wrap;
    gap: 10px;
  }

  .mc-item-info {
    flex-basis: calc(100% - 66px);
  }

  .mc-item-actions {
    margin-left: 56px;
  }
}
</style>
