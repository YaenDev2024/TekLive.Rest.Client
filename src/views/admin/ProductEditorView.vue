<script setup lang="ts">
/**
 * ProductEditorView · "Editar Productos" (Fase 6.3) — builder de productos
 * del menú (templates dinámicos) con grupos de opciones que el wizard del POS
 * consume (optionGroups → DynamicOptionsModal). Referencia Flutter:
 * create_combo_new.dart (builder de combos dinámicos) adaptado al contrato
 * REST del backend nuevo (api/rest/catalog/admin/products).
 *
 * UI-PARITY LISTA (ronda 2026-11-13, SOLO UI — petición: "clavar el UI igual
 * que el original, el cliente está familiarizado"): la parte LISTA es réplica
 * EXACTA de manage_product_templates_screen.dart ('Gestionar Templates'):
 * - AppBar L106-131: título 'Gestionar Templates' + ElevatedButton.icon VERDE
 *   'Nuevo Template' (única acción; el original NO tiene refresh — el reload
 *   ocurre al volver del editor y tras guardar/eliminar vía store).
 * - Panel 'Contexto de alcance' L173-210: margin 16/12/16/0, padding 12,
 *   borde grey[700] radius 10, título bold + ScopeSelector. Filtro EXACTO de
 *   scope_filter.dart L42-64 (NO jerárquico como el de ManageCatalogView):
 *   GLOBAL→solo GLOBAL, SUCURSAL→solo SUCURSAL, PLANT→solo PLANT plantId==N;
 *   item SIN scope → SIEMPRE visible; dedup por id. PLANT sin piso →
 *   snackbar 'Selecciona un piso para filtrar'.
 * - Buscador L211-229: hint 'Buscar template por nombre, descripción o
 *   grupo', lupa prefix, X solo con query (L156-169: match name/description/
 *   groupNames join(' ')).
 * - Cards L282-437: Card grey[900], imagen 150px con fallback
 *   image_not_supported (brokenImageIds patrón PosPiso1View), nombre 18 bold,
 *   precio #FF6E40 (deepOrangeAccent), badge scope purple900/700
 *   (scopeBadgeLabel scope_filter L69-81 con caso '—'), badge 'N grupos'
 *   blue900/700 (SIN pluralizar: '1 grupos' literal L365), descripción
 *   grey400 13 maxLines 2, chips de primeros 3 grupos (grey[800], fontSize
 *   11), botones Editar azul #2196F3 / Eliminar rojo #F44336 CON texto.
 * - Confirm delete L64-102: 'Confirmar eliminación' / '¿Estás seguro de que
 *   deseas eliminar este template?' / Cancelar + Eliminar (rojo); toasts
 *   '✅ Template eliminado' / '❌ Error: …'.
 * - Empty L230-273: icono inventory_2 64 grey[600] + 'No hay templates
 *   creados para este alcance' + botón deepOrangeAccent 'Crear Template';
 *   con query sin resultados → 'No se encontraron templates para "$query"'.
 *
 * Editor inline (formulario pe-*) INTACTO funcionalmente — solo se alinean
 * sus títulos al original (create_product_template.dart L665): 'Editar
 * Producto' (editando) / 'Crear Nuevo Producto' (creando).
 *
 * Estructura del editor (sin cambios):
 * - Nombre*, Descripción, Categoría (AppSelect, opcional), Precio base*
 *   (sanitize réplica ManageCatalogView), Alcance (ScopeSelector), Activo
 *   (checkbox estilizado, solo editar) y GRUPOS DE OPCIONES: cada grupo con
 *   Nombre*, Tipo (AppSelect radio/checkbox), min/max selecciones, orden, y
 *   valores = picker de item de Gestionar Catálogo (AppSelect con items
 *   activos, label = item.nombre) + priceModifier (default 0) + orden +
 *   default (único si radio). Botones 'Agregar grupo'/'Agregar opción'/
 *   quitar opción/quitar grupo.
 * - Validaciones (toast con el error específico): nombre requerido, precio
 *   >= 0, PLANT requiere plantId, cada grupo requiere groupName + al menos 1
 *   valor con catalogItemId.
 * - Guardar → POST/PUT según modo → toast éxito → recargar lista → cerrar.
 *
 * ⚠️ Lección defineModel (ScopeSelector): aquí NO se relee ningún v-model
 * después de escribirlo en el mismo tick; los drafts son objetos reactivos
 * explícitos mutados por handlers.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Archive,
  CircleAlert,
  ImageOff,
  ListPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import ScopeSelector from '../../components/admin/ScopeSelector.vue'
import type { ScopeValue } from '../../components/admin/ScopeSelector.vue'
import { AppSelect, AppSpinner } from '../../components/ui'
import type { AppSelectOption } from '../../components/ui/AppSelect.vue'
import { session } from '../../services/auth'
import { useAdminProductsStore } from '../../stores/adminProducts'
import { useAdminCategoriesStore } from '../../stores/adminCategories'
import { useAdminCatalogStore } from '../../stores/adminCatalog'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { CatalogScopeType, RestAdminProduct } from '../../api/rest'

const router = useRouter()
const toast = useToastStore()
const productsStore = useAdminProductsStore()
const categoriesStore = useAdminCategoriesStore()
const catalogItemsStore = useAdminCatalogStore()

// --- Guard de rol (mismo patrón que ManageCatalogView onMounted) ---------------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void productsStore.loadProducts()
  // Categorías (PARTE A) para el editor y el nombre de categoría.
  void categoriesStore.loadCategories()
  // Items de Gestionar Catálogo para el picker de valores (solo activos).
  void catalogItemsStore.loadItems()
})

// --- goBack: back arrow del AppBar → admin-dashboard (o cierra editor) ----------

async function goBack(): Promise<void> {
  if (editorOpen.value) {
    closeEditor()
    return
  }
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- UI-PARITY: contexto de alcance de la LISTA (L173-210 + scope_filter) -------

/**
 * Alcance del filtro de la lista (default GLOBAL réplica _scopeType L23).
 * INDEPENDIENTE del formScope del editor (ese vive abajo).
 */
const listScope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })

/**
 * Filtro EXACTO de scope_filter.dart L42-64 (matchesScopeFilter) + dedup por
 * id (L85-95): GLOBAL→solo items scopeType=='GLOBAL'; SUCURSAL→solo
 * 'SUCURSAL'; PLANT→solo 'PLANT' && plantId==N. Item SIN scope (scopes vacío/
 * undefined) → SIEMPRE visible (no ocultar datos de backend viejo).
 * 100% client-side sobre productsStore.sortedProducts (computed local, el
 * store NO se toca).
 */
const scopedProducts = computed<RestAdminProduct[]>(() => {
  const { scopeType, plantId } = listScope.value
  const seen = new Set<number>()
  const result: RestAdminProduct[] = []
  for (const product of productsStore.sortedProducts) {
    if (seen.has(product.id)) continue
    seen.add(product.id)
    const s = product.scopes?.[0]
    // Scope desconocido/vacío: visible siempre (scope_filter L48-49).
    if (s == null || s.scopeType.trim() === '') {
      result.push(product)
      continue
    }
    if (scopeType === 'GLOBAL') {
      if (s.scopeType === 'GLOBAL') result.push(product)
    } else if (scopeType === 'SUCURSAL') {
      if (s.scopeType === 'SUCURSAL') result.push(product)
    } else if (scopeType === 'PLANT') {
      // Réplica L57-59: sin filterPlantId aún, el filtro no muestra PLANT.
      if (s.scopeType === 'PLANT' && plantId != null && s.plantId === plantId) {
        result.push(product)
      }
    } else {
      // Filtro desconocido: no filtrar (L61-62).
      result.push(product)
    }
  }
  return result
})

/**
 * Réplica onChanged L189-206: PLANT sin piso → snackbar 'Selecciona un piso
 * para filtrar'. La lista se re-filtra reactiva (computed). El ScopeSelector
 * emite (scopeType, plantId) como dos argumentos.
 */
function onListScopeChange(scopeType: CatalogScopeType, plantId: number | null): void {
  listScope.value = { scopeType, plantId }
  if (scopeType === 'PLANT' && plantId == null) {
    toast.warning('Selecciona un piso para filtrar')
  }
}

/** Etiqueta del badge de alcance réplica scopeBadgeLabel (L69-81): con '—'. */
function scopeBadgeLabel(
  scopes: { scopeType: CatalogScopeType; plantId?: number | null }[] | undefined,
): string {
  const s = scopes?.[0]
  if (s == null) return '—'
  switch (s.scopeType) {
    case 'PLANT':
      return s.plantId != null ? `Piso #${s.plantId}` : 'Piso'
    case 'SUCURSAL':
      return 'Sucursal'
    case 'GLOBAL':
      return 'Global'
    default:
      return s.scopeType
  }
}

// --- UI-PARITY: buscador (L156-169 + L211-229) -----------------------------------

const searchQuery = ref('')

/** ¿Hay query? (controla la X del suffix). */
const hasSearch = computed(() => searchQuery.value.trim().length > 0)

/**
 * Filtro de búsqueda réplica L156-169: query trim lowercase; match si
 * name.contains || description.contains || optionGroups names join(' ')
 * .contains. Se aplica SOBRE scopedProducts (alcance primero, como el
 * original: _loadTemplates filtra por scope y L158-169 refina por query).
 */
const filteredProducts = computed<RestAdminProduct[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (query === '') return scopedProducts.value
  return scopedProducts.value.filter((product) => {
    const groupNames = (product.optionGroups ?? [])
      .map((group) => group.groupName)
      .join(' ')
      .toLowerCase()
    return (
      product.name.toLowerCase().includes(query) ||
      (product.description ?? '').toLowerCase().includes(query) ||
      groupNames.includes(query)
    )
  })
})

function clearSearch(): void {
  searchQuery.value = ''
}

// --- UI-PARITY: imagen rota (patrón brokenImageIds de PosPiso1View L242-254) ----

const brokenImageIds = ref<Set<number>>(new Set())
function onCardImageError(productId: number): void {
  if (!brokenImageIds.value.has(productId)) {
    const next = new Set(brokenImageIds.value)
    next.add(productId)
    brokenImageIds.value = next
  }
}

// --- Editor: drafts -----------------------------------------------------------------

type GroupType = 'radio' | 'checkbox'

interface ValueDraft {
  catalogItemId: number | null
  priceModifier: string
  displayOrder: string
  isDefault: boolean
}

interface GroupDraft {
  groupName: string
  groupType: GroupType
  minSelections: string
  maxSelections: string
  displayOrder: string
  values: ValueDraft[]
}

interface ProductForm {
  name: string
  description: string
  /** 0 = 'Sin categoría' (se envía null). */
  categoryId: number | null
  basePrice: string
  isActive: boolean
}

function emptyForm(): ProductForm {
  return {
    name: '',
    description: '',
    categoryId: 0,
    basePrice: '0.00',
    isActive: true,
  }
}

function emptyValue(order: number): ValueDraft {
  return { catalogItemId: null, priceModifier: '0.00', displayOrder: String(order), isDefault: false }
}

function emptyGroup(order: number): GroupDraft {
  return {
    groupName: '',
    groupType: 'radio',
    minSelections: '0',
    maxSelections: '1',
    displayOrder: String(order),
    values: [emptyValue(1)],
  }
}

const editorOpen = ref(false)
const editingProduct = ref<RestAdminProduct | null>(null)
const form = reactive<ProductForm>(emptyForm())
const formScope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })
const groups = ref<GroupDraft[]>([])
const submitting = ref(false)
const deleting = ref(false)
const confirmTarget = ref<RestAdminProduct | null>(null)

const editorTitle = computed(() =>
  // UI-parity create_product_template.dart L665 (textos EXACTOS).
  editingProduct.value == null ? 'Crear Nuevo Producto' : 'Editar Producto',
)

function openCreate(): void {
  Object.assign(form, emptyForm())
  formScope.value = { scopeType: 'GLOBAL', plantId: null }
  groups.value = [emptyGroup(1)] // arranca con 1 grupo listo para llenar
  editingProduct.value = null
  editorOpen.value = true
}

function openEdit(product: RestAdminProduct): void {
  editingProduct.value = product
  Object.assign(form, {
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId ?? 0,
    basePrice: product.basePrice.toFixed(2),
    isActive: product.isActive,
  })
  const s = product.scopes?.[0]
  formScope.value =
    s == null
      ? { scopeType: 'GLOBAL', plantId: null }
      : { scopeType: s.scopeType, plantId: s.scopeType === 'PLANT' ? (s.plantId ?? null) : null }
  groups.value = (product.optionGroups ?? []).map((g, gi) => ({
    groupName: g.groupName,
    groupType: g.groupType === 'checkbox' ? 'checkbox' : 'radio',
    minSelections: String(g.minSelections),
    maxSelections: String(g.maxSelections),
    displayOrder: g.displayOrder > 0 ? String(g.displayOrder) : String(gi + 1),
    values:
      g.values.length > 0
        ? g.values.map((v, vi) => ({
            catalogItemId: v.catalogItemId,
            priceModifier: v.priceModifier.toFixed(2),
            displayOrder: v.displayOrder > 0 ? String(v.displayOrder) : String(vi + 1),
            isDefault: v.isDefault,
          }))
        : [emptyValue(1)],
  }))
  if (groups.value.length === 0) groups.value = [emptyGroup(1)]
  editorOpen.value = true
}

function closeEditor(): void {
  if (submitting.value) return
  editorOpen.value = false
  editingProduct.value = null
  groups.value = []
}

// --- Opciones de los AppSelect -------------------------------------------------------

/** Picker de valores: SOLO items activos de Gestionar Catálogo (item.nombre). */
const itemOptions = computed<AppSelectOption[]>(() =>
  catalogItemsStore.items
    .filter((item) => item.activo)
    .map((item) => ({ value: item.id, label: item.nombre })),
)

const categoryOptions = computed<AppSelectOption[]>(() => [
  { value: 0, label: 'Sin categoría' },
  ...categoriesStore.sortedCategories.map((c) => ({ value: c.id, label: c.nombre })),
])

const groupTypeOptions: AppSelectOption[] = [
  { value: 'radio', label: 'Radio (una sola elección)' },
  { value: 'checkbox', label: 'Checkbox (múltiple)' },
]

// --- Mutación de grupos/valores ------------------------------------------------------

function addGroup(): void {
  groups.value.push(emptyGroup(groups.value.length + 1))
}

function removeGroup(gi: number): void {
  groups.value.splice(gi, 1)
}

function addValue(gi: number): void {
  const g = groups.value[gi]
  if (g == null) return
  g.values.push(emptyValue(g.values.length + 1))
}

function removeValue(gi: number, vi: number): void {
  const g = groups.value[gi]
  if (g == null) return
  g.values.splice(vi, 1)
}

/**
 * Default del valor (checkbox en la UI): en grupo radio SOLO un default —
 * al marcar uno se limpian los demás (si se desmarca, queda sin default).
 */
function onValueDefaultChange(gi: number, vi: number): void {
  const g = groups.value[gi]
  const v = g?.values[vi]
  if (g == null || v == null) return
  if (g.groupType === 'radio' && v.isDefault) {
    g.values.forEach((other, i) => {
      if (i !== vi) other.isDefault = false
    })
  }
}

// --- Sanitización réplica de los FilteringTextInputFormatter ------------------------

/** Precio base (ManageCatalogView sanitizePrecio): ^\d+\.?\d{0,2}. */
function sanitizePrecio(): void {
  const cleaned = form.basePrice.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  form.basePrice =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

/** Solo dígitos (min/max/ordenes). */
function sanitizeDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/** priceModifier: decimal con signo '-' opcional solo al inicio. */
function sanitizeModifier(v: ValueDraft): void {
  let cleaned = v.priceModifier.replace(/[^\d.-]/g, '')
  const negative = cleaned.startsWith('-')
  cleaned = cleaned.replace(/-/g, '')
  const dot = cleaned.indexOf('.')
  cleaned =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  v.priceModifier = negative && cleaned !== '' && cleaned !== '.' ? `-${cleaned}` : cleaned
}

// --- Validación + submit --------------------------------------------------------------

/** Radios usados por default (input radio name único por grupo). */

function validateForm(): boolean {
  if (form.name.trim().length === 0) {
    toast.warning('El nombre es requerido')
    return false
  }
  const price = Number.parseFloat(form.basePrice)
  if (!Number.isFinite(price) || price < 0) {
    toast.warning('El precio debe ser mayor o igual a 0')
    return false
  }
  if (formScope.value.scopeType === 'PLANT' && formScope.value.plantId == null) {
    toast.warning('Selecciona un piso para el alcance')
    return false
  }
  for (let gi = 0; gi < groups.value.length; gi += 1) {
    const g = groups.value[gi]
    if (g.groupName.trim().length === 0) {
      toast.warning(`El grupo #${gi + 1} no tiene nombre`)
      return false
    }
    if (!g.values.some((v) => v.catalogItemId != null)) {
      toast.warning(`El grupo "${g.groupName.trim()}" requiere al menos una opción con item de catálogo`)
      return false
    }
  }
  return true
}

function buildPayload(): {
  name: string
  description: string | null
  categoryId: number | null
  basePrice: number
  imageUrl: string | null
  scopeType: CatalogScopeType
  sucursalId: number
  plantId: number | null
  optionGroups: {
    groupName: string
    groupType: string
    minSelections: number
    maxSelections: number
    displayOrder: number
    values: {
      catalogItemId: number
      priceModifier: number
      displayOrder: number
      isDefault: boolean
    }[]
  }[]
} {
  return {
    name: form.name.trim(),
    description: form.description.trim().length === 0 ? null : form.description.trim(),
    categoryId: form.categoryId != null && form.categoryId > 0 ? form.categoryId : null,
    basePrice: Number.parseFloat(form.basePrice) || 0,
    imageUrl: editingProduct.value?.imageUrl ?? null,
    scopeType: formScope.value.scopeType,
    sucursalId: POS_SUCURSAL_ID,
    plantId: formScope.value.scopeType === 'PLANT' ? formScope.value.plantId : null,
    optionGroups: groups.value.map((g, gi) => ({
      groupName: g.groupName.trim(),
      groupType: g.groupType,
      minSelections: Number.parseInt(g.minSelections, 10) || 0,
      maxSelections: Number.parseInt(g.maxSelections, 10) || 0,
      displayOrder: Number.parseInt(g.displayOrder, 10) || gi + 1,
      values: g.values
        .filter((v) => v.catalogItemId != null)
        .map((v, vi) => ({
          catalogItemId: v.catalogItemId as number,
          priceModifier: Number.parseFloat(v.priceModifier) || 0,
          displayOrder: Number.parseInt(v.displayOrder, 10) || vi + 1,
          isDefault: v.isDefault,
        })),
    })),
  }
}

async function submitEditor(): Promise<void> {
  if (submitting.value || !validateForm()) return
  submitting.value = true
  try {
    const payload = buildPayload()
    if (editingProduct.value == null) {
      await productsStore.createProduct(payload)
      toast.success('Producto creado exitosamente')
    } else {
      await productsStore.updateProduct(editingProduct.value.id, {
        ...payload,
        isActive: form.isActive,
      })
      toast.success('Producto actualizado exitosamente')
    }
    editorOpen.value = false
    editingProduct.value = null
    groups.value = []
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    submitting.value = false
  }
}

// --- Eliminación soft con confirm -----------------------------------------------------

function openConfirm(product: RestAdminProduct): void {
  confirmTarget.value = product
}

function closeConfirm(): void {
  if (deleting.value) return
  confirmTarget.value = null
}

async function confirmDelete(): Promise<void> {
  if (confirmTarget.value == null || deleting.value) return
  deleting.value = true
  try {
    await productsStore.deleteProduct(confirmTarget.value.id)
    // UI-parity manage_product_templates_screen.dart L90 (SnackBar EXACTO).
    toast.success('✅ Template eliminado')
    confirmTarget.value = null
  } catch (err) {
    // Réplica L97: '❌ Error: …'.
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `❌ Error: ${err.message}`
        : '❌ Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="pe-page">
    <!-- ===== AppBar réplica L106-131: back + 'Gestionar Templates' + verde
         'Nuevo Template' (única acción; SIN refresh — el original recarga al
         volver del editor y el store recarga tras guardar/eliminar) ===== -->
    <header class="pe-appbar">
      <button
        type="button"
        class="pe-icon-btn"
        :title="editorOpen ? 'Volver a la lista' : 'Regresar a Administración'"
        :aria-label="editorOpen ? 'Volver a la lista' : 'Regresar a Administración'"
        data-testid="pe-back"
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
      <h1 class="pe-appbar-title">
        {{ editorOpen ? editorTitle : 'Gestionar Templates' }}
      </h1>
      <div class="pe-appbar-actions">
        <button
          v-if="!editorOpen"
          type="button"
          class="pe-btn pe-btn--green pe-btn--compact"
          data-testid="pe-new"
          @click="openCreate"
        >
          <Plus :size="18" aria-hidden="true" />
          Nuevo Template
        </button>
      </div>
    </header>

    <main class="pe-body">
      <!-- ====================== LISTA (réplica manage_product_templates_screen L171-279) ====================== -->
      <template v-if="!editorOpen">
        <div v-if="productsStore.loading" class="pe-state" data-testid="pe-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="productsStore.error != null" class="pe-state" data-testid="pe-error">
          <CircleAlert :size="64" class="pe-state-error-icon" aria-hidden="true" />
          <p class="pe-state-text">{{ productsStore.error }}</p>
          <button
            type="button"
            class="pe-retry"
            data-testid="pe-retry"
            @click="productsStore.loadProducts(true)"
          >
            Reintentar
          </button>
        </div>

        <!-- ===== Panel 'Contexto de alcance' (L173-210) ===== -->
        <section
          v-else
          class="pe-scope-panel"
          data-testid="pe-scope-panel"
        >
          <h2 class="pe-scope-title">Contexto de alcance</h2>
          <!-- @change réplica onChanged L189-206 (PLANT sin piso → snackbar).
               v-model + listener change del ScopeSelector (misma fuente). -->
          <ScopeSelector
            v-model="listScope"
            @change="onListScopeChange"
          />
        </section>

        <!-- ===== Buscador (L211-229): hint exacto, lupa prefix, X con query ===== -->
        <div class="pe-search-wrap">
          <div class="pe-search">
            <Search :size="20" class="pe-search-icon" aria-hidden="true" />
            <input
              v-model="searchQuery"
              type="text"
              class="pe-search-input"
              placeholder="Buscar template por nombre, descripción o grupo"
              aria-label="Buscar template por nombre, descripción o grupo"
              data-testid="pe-search"
            />
            <button
              v-if="hasSearch"
              type="button"
              class="pe-search-clear"
              aria-label="Limpiar búsqueda"
              data-testid="pe-search-clear"
              @click="clearSearch"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </div>
        </div>

        <!-- ===== Empty SIN productos para el alcance (L230-258): icono
             inventory_2 + texto exacto + botón deepOrangeAccent ===== -->
        <div
          v-if="productsStore.products.length === 0"
          class="pe-state pe-empty-state"
          data-testid="pe-empty"
        >
          <Archive :size="64" class="pe-empty-icon" aria-hidden="true" />
          <p class="pe-state-text">No hay templates creados para este alcance</p>
          <button
            type="button"
            class="pe-btn pe-btn--accent"
            data-testid="pe-empty-create"
            @click="openCreate"
          >
            <Plus :size="18" aria-hidden="true" />
            Crear Template
          </button>
        </div>

        <!-- ===== Con query sin resultados (L259-265): texto con comillas ===== -->
        <p
          v-else-if="filteredProducts.length === 0"
          class="pe-state pe-no-results"
          data-testid="pe-no-results"
        >
          No se encontraron templates para "{{ searchQuery.trim() }}"
        </p>

        <!-- ===== Cards (L266-273 + _buildTemplateCard L282-441) ===== -->
        <ul v-else class="pe-list" data-testid="pe-list">
          <li
            v-for="product in filteredProducts"
            :key="product.id"
            class="pe-card"
            :data-testid="`pe-item-${product.id}`"
          >
            <!-- Imagen 150px cover con fallback image_not_supported (L289-304);
                 imageUrl vacía/null → SIN bloque de imagen -->
            <span
              v-if="product.imageUrl != null && product.imageUrl !== ''"
              class="pe-card-media"
            >
              <img
                v-if="!brokenImageIds.has(product.id)"
                :src="product.imageUrl"
                alt=""
                loading="lazy"
                @error="onCardImageError(product.id)"
              />
              <span v-else class="pe-card-media-fallback" aria-hidden="true">
                <ImageOff :size="28" />
              </span>
            </span>

            <span class="pe-card-body">
              <!-- Row spaceBetween: nombre+precio | badge scope | badge grupos -->
              <span class="pe-card-top">
                <span class="pe-card-heading">
                  <span
                    class="pe-item-name"
                    :class="{ 'pe-item-name--inactive': !product.isActive }"
                  >
                    {{ product.name }}
                  </span>
                  <span class="pe-card-price">${{ product.basePrice.toFixed(2) }}</span>
                </span>
                <span class="pe-card-scope" :data-testid="`pe-item-scope-${product.id}`">
                  {{ scopeBadgeLabel(product.scopes) }}
                </span>
                <span
                  class="pe-card-groups"
                  :data-testid="`pe-item-groups-${product.id}`"
                >
                  {{ (product.optionGroups ?? []).length }} grupos
                </span>
              </span>

              <!-- Descripción (si no vacía): grey400 13 maxLines 2 (L373-382) -->
              <span
                v-if="product.description != null && product.description !== ''"
                class="pe-card-desc"
              >
                {{ product.description }}
              </span>

              <!-- Chips de grupos: primeros 3 (L384-400) -->
              <span
                v-if="product.optionGroups != null && product.optionGroups.length > 0"
                class="pe-card-chips"
              >
                <span
                  v-for="group in product.optionGroups.slice(0, 3)"
                  :key="group.id"
                  class="pe-card-chip"
                >
                  {{ group.groupName }}
                </span>
              </span>

              <!-- Botones Row end: Editar azul / Eliminar rojo CON texto (L402-437) -->
              <span class="pe-item-actions">
                <button
                  type="button"
                  class="pe-btn pe-btn--blue pe-btn--small"
                  :data-testid="`pe-edit-${product.id}`"
                  @click="openEdit(product)"
                >
                  <Pencil :size="16" aria-hidden="true" />
                  Editar
                </button>
                <button
                  type="button"
                  class="pe-btn pe-btn--red pe-btn--small"
                  :data-testid="`pe-delete-${product.id}`"
                  @click="openConfirm(product)"
                >
                  <Trash2 :size="16" aria-hidden="true" />
                  Eliminar
                </button>
              </span>
            </span>
          </li>
        </ul>
      </template>

      <!-- ====================== EDITOR (pantalla completa) ====================== -->
      <form v-else class="pe-editor" data-testid="pe-editor" @submit.prevent="submitEditor">
        <div class="pe-editor-fields">
          <!-- Nombre * -->
          <div class="pe-field">
            <label class="pe-label" for="pe-name">Nombre *</label>
            <input
              id="pe-name"
              v-model="form.name"
              type="text"
              class="pe-input"
              data-testid="pe-name"
              autocomplete="off"
            />
          </div>

          <!-- Descripción -->
          <div class="pe-field">
            <label class="pe-label" for="pe-desc">Descripción</label>
            <textarea
              id="pe-desc"
              v-model="form.description"
              class="pe-input pe-textarea"
              rows="2"
              data-testid="pe-desc"
            ></textarea>
          </div>

          <!-- Categoría (AppSelect, opcional con 'Sin categoría') -->
          <div class="pe-field">
            <label class="pe-label" id="pe-category-label" for="pe-category">Categoría</label>
            <AppSelect
              v-model="form.categoryId"
              :options="categoryOptions"
              testid="pe-category"
              aria-label="Categoría"
            />
          </div>

          <!-- Precio base * -->
          <div class="pe-field">
            <label class="pe-label" for="pe-price">Precio base *</label>
            <div class="pe-input-wrap">
              <span class="pe-prefix">$</span>
              <input
                id="pe-price"
                v-model="form.basePrice"
                type="text"
                inputmode="decimal"
                class="pe-input pe-input--prefixed"
                data-testid="pe-price"
                @input="sanitizePrecio"
              />
            </div>
          </div>

          <!-- Alcance -->
          <div class="pe-field">
            <ScopeSelector v-model="formScope" />
          </div>

          <!-- Activo SOLO en editar -->
          <label v-if="editingProduct != null" class="pe-switch" data-testid="pe-activo">
            <input v-model="form.isActive" type="checkbox" />
            <span class="pe-switch-track" aria-hidden="true"></span>
            <span class="pe-switch-label">Activo</span>
          </label>
        </div>

        <!-- ===== Grupos de opciones ===== -->
        <section class="pe-groups" data-testid="pe-groups">
          <h2 class="pe-groups-title">Grupos de opciones</h2>

          <div
            v-for="(g, gi) in groups"
            :key="gi"
            class="pe-group"
            :data-testid="`pe-group-${gi}`"
          >
            <div class="pe-group-head">
              <span class="pe-group-index">{{ gi + 1 }}</span>
              <input
                v-model="g.groupName"
                type="text"
                class="pe-input pe-group-name"
                placeholder="Nombre del grupo *"
                :aria-label="`Nombre del grupo ${gi + 1}`"
                :data-testid="`pe-group-name-${gi}`"
                autocomplete="off"
              />
              <button
                type="button"
                class="pe-item-btn pe-item-btn--delete"
                :aria-label="`Quitar grupo ${gi + 1}`"
                :data-testid="`pe-remove-group-${gi}`"
                @click="removeGroup(gi)"
              >
                <Trash2 :size="18" aria-hidden="true" />
              </button>
            </div>

            <div class="pe-group-grid">
              <div class="pe-field">
                <label class="pe-label" :for="`pe-group-type-${gi}`">Tipo</label>
                <AppSelect
                  v-model="g.groupType"
                  :options="groupTypeOptions"
                  :testid="`pe-group-type-${gi}`"
                  :aria-label="`Tipo del grupo ${gi + 1}`"
                />
              </div>
              <div class="pe-field">
                <label class="pe-label" :for="`pe-group-min-${gi}`">Min selecciones</label>
                <input
                  :id="`pe-group-min-${gi}`"
                  v-model="g.minSelections"
                  type="text"
                  inputmode="numeric"
                  class="pe-input"
                  :data-testid="`pe-group-min-${gi}`"
                  @input="g.minSelections = sanitizeDigits(g.minSelections)"
                />
              </div>
              <div class="pe-field">
                <label class="pe-label" :for="`pe-group-max-${gi}`">Max selecciones</label>
                <input
                  :id="`pe-group-max-${gi}`"
                  v-model="g.maxSelections"
                  type="text"
                  inputmode="numeric"
                  class="pe-input"
                  :data-testid="`pe-group-max-${gi}`"
                  @input="g.maxSelections = sanitizeDigits(g.maxSelections)"
                />
              </div>
              <div class="pe-field">
                <label class="pe-label" :for="`pe-group-order-${gi}`">Orden</label>
                <input
                  :id="`pe-group-order-${gi}`"
                  v-model="g.displayOrder"
                  type="text"
                  inputmode="numeric"
                  class="pe-input"
                  :data-testid="`pe-group-order-${gi}`"
                  @input="g.displayOrder = sanitizeDigits(g.displayOrder)"
                />
              </div>
            </div>

            <!-- Valores del grupo -->
            <div class="pe-values">
              <div
                v-for="(v, vi) in g.values"
                :key="vi"
                class="pe-value"
                :data-testid="`pe-value-${gi}-${vi}`"
              >
                <div class="pe-value-row">
                  <div class="pe-field pe-field--grow">
                    <label class="pe-label" :for="`pe-value-item-${gi}-${vi}`">Item de catálogo</label>
                    <AppSelect
                      v-model="v.catalogItemId"
                      :options="itemOptions"
                      placeholder="Selecciona item"
                      :testid="`pe-value-item-${gi}-${vi}`"
                      :aria-label="`Item de catálogo de la opción ${vi + 1} del grupo ${gi + 1}`"
                    />
                  </div>
                  <button
                    type="button"
                    class="pe-value-remove"
                    :aria-label="`Quitar opción ${vi + 1} del grupo ${gi + 1}`"
                    :data-testid="`pe-remove-value-${gi}-${vi}`"
                    @click="removeValue(gi, vi)"
                  >
                    <X :size="18" aria-hidden="true" />
                  </button>
                </div>
                <div class="pe-value-row pe-value-row--fields">
                  <div class="pe-field">
                    <label class="pe-label" :for="`pe-value-mod-${gi}-${vi}`">Precio adicional</label>
                    <div class="pe-input-wrap">
                      <span class="pe-prefix">$</span>
                      <input
                        :id="`pe-value-mod-${gi}-${vi}`"
                        v-model="v.priceModifier"
                        type="text"
                        inputmode="decimal"
                        class="pe-input pe-input--prefixed"
                        :data-testid="`pe-value-mod-${gi}-${vi}`"
                        @input="sanitizeModifier(v)"
                      />
                    </div>
                  </div>
                  <div class="pe-field">
                    <label class="pe-label" :for="`pe-value-order-${gi}-${vi}`">Orden</label>
                    <input
                      :id="`pe-value-order-${gi}-${vi}`"
                      v-model="v.displayOrder"
                      type="text"
                      inputmode="numeric"
                      class="pe-input"
                      :data-testid="`pe-value-order-${gi}-${vi}`"
                      @input="v.displayOrder = sanitizeDigits(v.displayOrder)"
                    />
                  </div>
                  <label class="pe-value-default" :data-testid="`pe-value-default-${gi}-${vi}`">
                    <input
                      v-model="v.isDefault"
                      type="checkbox"
                      @change="onValueDefaultChange(gi, vi)"
                    />
                    <span>Default</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                class="pe-btn pe-btn--ghost pe-btn--small"
                :data-testid="`pe-add-value-${gi}`"
                @click="addValue(gi)"
              >
                <ListPlus :size="18" aria-hidden="true" />
                Agregar opción
              </button>
            </div>
          </div>

          <button
            type="button"
            class="pe-btn pe-btn--ghost pe-btn--block"
            data-testid="pe-add-group"
            @click="addGroup"
          >
            <Plus :size="18" aria-hidden="true" />
            Agregar grupo
          </button>
        </section>

        <!-- ===== Acciones del editor ===== -->
        <div class="pe-editor-actions">
          <button
            type="button"
            class="pe-btn pe-btn--ghost"
            data-testid="pe-cancel"
            :disabled="submitting"
            @click="closeEditor"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="pe-btn pe-btn--primary"
            data-testid="pe-save"
            :disabled="submitting"
            @click="submitEditor"
          >
            Guardar
          </button>
        </div>
      </form>
    </main>

    <!-- ===== Confirm de eliminación (UI-parity L64-102: textos EXACTOS del
         AlertDialog original) ===== -->
    <AppModal
      v-if="confirmTarget != null"
      title="Confirmar eliminación"
      :width="400"
      @close="closeConfirm"
    >
      <p class="pe-confirm-text" data-testid="pe-confirm-text">
        ¿Estás seguro de que deseas eliminar este template?
      </p>
      <template #footer>
        <button
          type="button"
          class="pe-btn pe-btn--ghost"
          data-testid="pe-confirm-cancel"
          :disabled="deleting"
          @click="closeConfirm"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pe-btn pe-btn--danger"
          data-testid="pe-confirm-ok"
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
   ManageCatalogView/ManageCategoriesView: var(--bg), sin rail). */
.pe-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, acciones a la derecha ===== */
.pe-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.pe-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pe-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

/* IconButton 48px circular, hover white08 (patrón ManageCatalogView) */
.pe-icon-btn {
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

.pe-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado (máx ~800px, mismo ancho que ManageCatalogView) ===== */
.pe-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.pe-btn {
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

.pe-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.pe-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.pe-btn--danger {
  background: var(--error);
  color: #ffffff;
}

.pe-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.pe-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.pe-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

/* UI-parity: verde del AppBar (Colors.green #4CAF50, L122) */
.pe-btn--green {
  background: #4caf50;
  color: #ffffff;
}

.pe-btn--green:hover:not(:disabled) {
  filter: brightness(1.08);
}

/* deepOrangeAccent #FF6E40: 'Crear Template' del empty (L250-256) */
.pe-btn--accent {
  background: #ff6e40;
  color: #ffffff;
}

.pe-btn--accent:hover:not(:disabled) {
  filter: brightness(1.08);
}

/* 'Editar' Colors.blue #2196F3 (L414-422) */
.pe-btn--blue {
  background: #2196f3;
  color: #ffffff;
}

.pe-btn--blue:hover:not(:disabled) {
  filter: brightness(1.08);
}

/* 'Eliminar' Colors.red #F44336 (L425-433) */
.pe-btn--red {
  background: #f44336;
  color: #ffffff;
}

.pe-btn--red:hover:not(:disabled) {
  filter: brightness(1.08);
}

.pe-btn--compact {
  padding: 10px 16px;
  font-size: 14px;
}

.pe-btn--small {
  padding: 9px 14px;
  font-size: 13px;
}

.pe-btn--block {
  width: 100%;
}

.pe-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Lista ===== */
.pe-list-wrap,
.pe-state {
  margin: 0;
}

.pe-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

/* ===== Empty con icono (L230-258): inventory_2 64px grey[600] ===== */
.pe-empty-icon {
  color: #757575; /* Colors.grey.shade600 */
}

.pe-state-error-icon {
  color: var(--error);
}

.pe-state-text {
  margin: 0;
  color: var(--text);
}

.pe-retry {
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

.pe-retry:hover {
  background: var(--primary-hover);
}

/* ===== Panel 'Contexto de alcance' (L173-210): margin 16/12/16/0,
   padding 12, borde grey[700] radius 10 (mismo patrón mc-scope-panel) ===== */
.pe-scope-panel {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid var(--border); /* Colors.grey.shade700 #616161 */
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px; /* SizedBox(height: 8) L178 */
}

.pe-scope-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700; /* TextStyle(fontWeight: FontWeight.bold) L176 */
  color: var(--text);
}

/* ===== Buscador (L211-229): padding 16/16/16/8, radius 10 ===== */
.pe-search-wrap {
  padding: 8px 16px 16px;
}

.pe-search {
  position: relative;
}

.pe-search-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

.pe-search-input {
  width: 100%;
  height: 48px;
  padding: 0 44px 0 40px;
  background: rgba(0, 0, 0, 0.3); /* fill del tema, igual que el resto de inputs */
  border: 1px solid var(--border);
  border-radius: 10px; /* OutlineInputBorder radius 10 L218 */
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
}

.pe-search-input::placeholder {
  color: var(--text-faint);
}

.pe-search-input:focus {
  outline: none;
  border-color: var(--primary);
}

.pe-search-clear {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-faint);
  cursor: pointer;
  transition: background 0.15s ease;
}

.pe-search-clear:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

/* ===== No-results con query (L259-265): grey[400], centrado ===== */
.pe-no-results {
  margin: 0;
  padding: 32px 24px;
  text-align: center;
  color: #bdbdbd; /* Colors.grey.shade400 */
  font-size: 15px;
}

/* ===== Lista: ListView padding 16, cards grey[900] margin-bottom 16 ===== */
.pe-list {
  margin: 0;
  padding: 16px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px; /* margin bottom 16 de cada Card L282 */
}

/* ===== Card (L282-437): bg grey[900] #212121, radius 12, columna ===== */
.pe-card {
  display: flex;
  flex-direction: column;
  background: var(--bg); /* Colors.grey[900] = #212121 L281 */
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* Imagen 150px cover con ClipRRect radius 12 top (L289-304) */
.pe-card-media {
  display: block;
  height: 150px;
}

.pe-card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Fallback image_not_supported: container grey[800] #424242 + icono */
.pe-card-media-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: #424242; /* Colors.grey.shade800 */
  color: var(--text-faint);
}

.pe-card-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px;
}

/* Row spaceBetween (L323-370): heading | badge scope | badge grupos */
.pe-card-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}

.pe-card-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px; /* SizedBox(height: 4) L334 */
}

.pe-item-name {
  font-size: 18px; /* fontSize 18 bold L329 */
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap; /* maxLines 1 */
}

.pe-item-name--inactive {
  text-decoration: line-through;
}

/* Precio deepOrangeAccent #FF6E40, fontSize 16 bold (L331-333) */
.pe-card-price {
  font-size: 16px;
  font-weight: 700;
  color: #ff6e40;
}

/* Badge scope: purple900 α0.35 + borde purple700 (L342-355) */
.pe-card-scope {
  flex: none;
  padding: 4px 8px;
  margin-right: 8px;
  border: 1px solid #7b1fa2; /* Colors.purple.shade700 */
  border-radius: 8px;
  background: rgba(74, 20, 90, 0.35); /* purple900 #4A148C α 0.35 */
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
}

/* Badge grupos: blue900 α0.3 + borde blue700 (L356-369); 'N grupos' LITERAL
   sin pluralizar ('1 grupos' como el original '${n} grupos' L365) */
.pe-card-groups {
  flex: none;
  padding: 6px 12px;
  border: 1px solid #1976d2; /* Colors.blue.shade700 */
  border-radius: 8px;
  background: rgba(13, 71, 161, 0.3); /* blue900 #0D47A1 α 0.3 */
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
}

/* Descripción grey400 13 maxLines 2 (L373-382) */
.pe-card-desc {
  margin: 12px 0;
  color: #bdbdbd; /* Colors.grey.shade400 */
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Chips de grupos: primeros 3, grey[800], fontSize 11, radius full (L384-400) */
.pe-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px; /* Wrap spacing 8 */
}

.pe-card-chip {
  padding: 4px 8px;
  border-radius: 999px;
  background: #424242; /* Colors.grey.shade800 */
  color: var(--text-muted);
  font-size: 11px;
}

/* Botones Row end (L402-437): Editar azul + 8px + Eliminar rojo */
.pe-item-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
}

/* ===== Editor ===== */
.pe-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.pe-editor-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pe-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pe-field--grow {
  flex: 1;
  min-width: 0;
}

.pe-label {
  font-size: 12px;
  color: var(--text-faint);
}

.pe-input-wrap {
  position: relative;
}

.pe-prefix {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.pe-input {
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

.pe-input--prefixed {
  padding-left: 30px;
}

.pe-textarea {
  height: auto;
  min-height: 68px;
  padding: 10px 12px;
  resize: vertical;
}

.pe-input:focus {
  border-color: var(--primary);
}

.pe-input::placeholder {
  color: var(--text-faint);
}

/* Switch 'Activo' (mismo checkbox estilizado que ManageCatalogView) */
.pe-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
  -webkit-user-select: none;
  user-select: none;
  align-self: flex-start;
}

.pe-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.pe-switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.15s ease;
}

.pe-switch-track::after {
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

.pe-switch input:checked + .pe-switch-track {
  background: var(--primary);
}

.pe-switch input:checked + .pe-switch-track::after {
  transform: translateX(18px);
  background: #ffffff;
}

.pe-switch input:focus-visible + .pe-switch-track {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.pe-switch-label {
  font-size: 15px;
  color: var(--text);
}

/* ===== Grupos de opciones ===== */
.pe-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pe-groups-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.pe-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
}

.pe-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pe-group-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.22);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

.pe-group-name {
  flex: 1;
  min-width: 0;
}

.pe-group-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.pe-values {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}

.pe-value {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.2);
}

.pe-value-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.pe-value-row--fields {
  display: grid;
  grid-template-columns: 1fr 84px auto;
  gap: 8px;
  align-items: end;
}

.pe-value-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--error);
  cursor: pointer;
  transition: background 0.15s ease;
}

.pe-value-remove:hover {
  background: rgba(255, 255, 255, 0.08);
}

.pe-value-default {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 4px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  white-space: nowrap;
}

.pe-value-default input {
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
  cursor: pointer;
}

/* ===== Acciones del editor ===== */
.pe-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-bottom: 8px;
}

/* ===== Confirm texto ===== */
.pe-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Responsive móvil ===== */
@media (max-width: 560px) {
  .pe-appbar-title {
    font-size: 19px;
  }

  .pe-list,
  .pe-editor {
    padding: 12px;
  }

  /* Cards: badges pueden envolver bajo el heading */
  .pe-card-top {
    flex-wrap: wrap;
  }

  .pe-group-grid {
    grid-template-columns: 1fr 1fr;
  }

  .pe-value-row--fields {
    grid-template-columns: 1fr 72px auto;
  }

  .pe-editor-actions {
    flex-direction: column-reverse;
  }

  .pe-editor-actions .pe-btn {
    width: 100%;
  }
}
</style>
