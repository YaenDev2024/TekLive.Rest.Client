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
 * UI-PARITY EDITOR (ronda 2026-11-13b, SOLO UI — petición: "salsas con
 * checks… revisa editar productos que quede igual que el original"): el
 * EDITOR es réplica EXACTA del WIZARD de create_product_template.dart:
 * - Stepper 3 pasos L676-710: 'Información básica' / 'Opciones del producto'
 *   / 'Revisar y confirmar'; Continue avanza (paso 2 = submit), Cancel
 *   retrocede (paso 0 cierra). Indicadores circulares numerados + conector
 *   vertical; activo deepOrangeAccent #FF6E40; isActive currentStep>=n.
 * - Paso 1 L714-939: panel 'Alcance del template' (border grey700 radius 12
 *   — distinto del radius 10 del panel de la LISTA), ScopeSelector, Nombre
 *   (hint 'Ej: Charola Chica'), Descripción 3 líneas, Precio base '$ ',
 *   Categoría dropdown, imagen: preview 200px + botón deepOrange 'Seleccionar
 *   imagen'/'Cambiar imagen' (preview local inmediato + subida multipart real
 *   al guardar: POST /api/rest/catalog/admin/products/{id}/image con el campo
 *   `file`; la lectura de la imagen guardada se hace por descarga autenticada
 *   y object URL — ver src/api/productImages.ts).
 * - Paso 2 L941-1134: 'Grupos de opciones' 16 bold; grupos VACÍOS por
 *   defecto (L43: optionGroups = [] — el editor previo creaba uno); card por
 *   grupo grey[850] #303030: nombre hint 'Nombre del grupo (ej: Tipo de
 *   Carne)' radius 8 + delete rojo; dropdown 'Tipo de selección' con valores
 *   EXACTOS REQUIRED('Obligatorio (1)')/OPTIONAL('Opcional')/MULTIPLE
 *   ('Múltiple') default REQUIRED (L1229); min/max inputs SOLO en MULTIPLE
 *   (L1036); contenedor 'Items del catálogo' con botón deepOrange 'Agregar
 *   items' → DIALOGO + chips removibles deepOrange α0.3 de los items
 *   seleccionados ('Sin items seleccionados' grey400 si vacío); botón
 *   'Agregar grupo de opciones' al final.
 * - DIALOGO L278-498 (lo que pidió el usuario — salsas con checks):
 *   'Seleccionar items del catálogo', contenido 60vh scroll, items del store
 *   AGRUPADOS por tipo (SALSA/PROTEINA/…; orden de aparición, items
 *   alfabético), header por categoría: chip deepOrange α0.2 texto bold 13
 *   deepOrange + botón 'Todos' (toggle-all: deepOrange activo / grey800 +
 *   borde grey600, icono checkbox 18 + 'Todos' 12 w600), FilterChips por item
 *   (label 12, bg grey[850] #303030, selected deepOrangeAccent, borde
 *   deepOrange/grey700, padding 8h/4v) MULTI compartido. Vacío: 'No hay items
 *   disponibles para este alcance. Revisa el piso o el scope seleccionado.' /
 *   'Cargando catálogo...'. Acciones 'Cancelar' + 'Guardar selección'
 *   deepOrange bold; draft local aplicado al Guardar (resultado semántico
 *   idéntico al original que muta directo).
 * - Paso 3 L1136-1211: resumen Cards grey[850] con títulos 16 bold
 *   deepOrange ('Información básica' / 'Grupos de opciones'), filas
 *   label/value (label grey, value bold derecha): Nombre/Descripción/Precio
 *   '$ '/Categoría ('No seleccionada')/Imagen 'Seleccionada' si hay;
 *   grupos → 'nombre (o (Sin nombre))' : 'REQUIRED|OPTIONAL|MULTIPLE' (value
 *   del dropdown, NO el label); cierre '¿Confirmas crear este producto?' 16
 *   bold (mismo texto en edición, como el original).
 * - Validaciones L500-545 toasts EXACTOS: 'El nombre del producto es
 *   requerido' / 'Debe seleccionar una categoría' / 'Debe agregar al menos
 *   un grupo de opciones' / 'Selecciona un piso para el alcance' / 'El grupo
 *   N no tiene items seleccionados'. Éxito: '✅ Producto creado
 *   exitosamente' / '✅ Producto actualizado exitosamente' (el original
 *   espera 1.5s antes de pop — NO replicado: cierre normal).
 * - Mapeo tipo→contrato REST (buildPayload): REQUIRED→radio min1 max1;
 *   OPTIONAL→radio min0 max1; MULTIPLE→checkbox min/max de los inputs. Al
 *   CARGAR en edición: radio min>=1→REQUIRED, radio min0→OPTIONAL,
 *   checkbox→MULTIPLE.
 * - Carga del diálogo filtrada por alcance (L173-247, JERÁRQUICO réplica
 *   _loadData L196-201 — NO el scope_filter EXACTO de la LISTA): GLOBAL/
 *   SUCURSAL→TODOS los items del store (el original pide sin plantId y el
 *   backend devuelve todo); PLANT N→sin-scope + GLOBAL + SUCURSAL + PLANT
 *   plantId==N (backend jerárquico, nunca otros pisos); dedup por id;
 *   items ya seleccionados fuera del nuevo alcance NO se remueven
 *   (comportamiento original). Mismo filtro para CATEGORÍAS (misma
 *   _loadData).
 *
 * Estructura del editor previa (pe-editor) REEMPLAZADA por el wizard; los
 * testids del formulario se conservan (pe-name/pe-desc/pe-category/pe-price,
 * pe-groups/pe-group-N/pe-group-name-N) + nuevos pe-step-N/pe-next/pe-back/
 * pe-dialog/pe-dialog-item-{id}/pe-dialog-all-{tipo}/pe-add-items-{gi}/
 * pe-chip-{gi}-{itemId}/pe-summary.
 *
 * ⚠️ Lección defineModel (ScopeSelector): aquí NO se relee ningún v-model
 * después de escribirlo en el mismo tick; los drafts son objetos reactivos
 * explícitos mutados por handlers.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Archive,
  CheckSquare,
  CircleAlert,
  Image as ImageIcon,
  ImageOff,
  Pencil,
  Plus,
  Search,
  Square,
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
import { deleteAdminProductImage, uploadAdminProductImage } from '../../api/rest'
import { invalidateProductImage, loadProductImage } from '../../api/productImages'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type {
  CatalogScopeType,
  RestAdminCatalogItem,
  RestAdminCategory,
  RestAdminProduct,
} from '../../api/rest'

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

/**
 * Miniaturas del listado. `product.imageUrl` es una ruta RELATIVA de API
 * (`/api/rest/catalog/templates/{id}/image`) protegida por X-Api-Key + Bearer:
 * un `<img :src="product.imageUrl">` apuntaría al origen del cliente y sin
 * headers → 401. Aquí se descarga autenticada (caché compartida de
 * src/api/productImages.ts) y se pinta el object URL.
 */
const cardImageUrls = ref<Map<number, string>>(new Map())

/** Object URL de la miniatura (null = aún sin descargar o sin imagen). */
function cardImageSrc(productId: number): string | null {
  return cardImageUrls.value.get(productId) ?? null
}

function setCardImage(productId: number, url: string): void {
  if (cardImageUrls.value.get(productId) === url) return
  const next = new Map(cardImageUrls.value)
  next.set(productId, url)
  cardImageUrls.value = next
}

/** Quita la miniatura del DOM ANTES de revocar su object URL. */
function dropCardImage(productId: number): void {
  if (!cardImageUrls.value.has(productId)) return
  const next = new Map(cardImageUrls.value)
  next.delete(productId)
  cardImageUrls.value = next
}

/** Descarga (una sola vez por producto) las miniaturas visibles del listado. */
async function hydrateCardImages(): Promise<void> {
  const targets = filteredProducts.value.filter(
    (product) =>
      (product.imageUrl ?? '') !== '' &&
      cardImageSrc(product.id) == null &&
      !brokenImageIds.value.has(product.id),
  )
  await Promise.all(
    targets.map(async (product) => {
      // loadProductImage deduplica: si ya hay una descarga en vuelo o el
      // resultado está cacheado, no se hace otra petición.
      const url = await loadProductImage(product.id)
      if (url != null) setCardImage(product.id, url)
    }),
  )
}

/**
 * Re-sincroniza la miniatura tras subir/reemplazar la imagen.
 *
 * Orden importante: primero se suelta el object URL del estado (el DOM deja de
 * referenciarlo en el siguiente patch), DESPUÉS se revoca (revocarlo mientras
 * el `<img>` sigue vivo dispararía @error y ocultaría la imagen nueva), y por
 * último se vuelve a descargar UNA vez.
 */
async function refreshCardImage(productId: number): Promise<void> {
  dropCardImage(productId)
  await nextTick()
  invalidateProductImage(productId)
  const url = await loadProductImage(productId)
  if (url != null) setCardImage(productId, url)
}

watch(
  () => filteredProducts.value.map((product) => `${product.id}:${product.imageUrl ?? ''}`).join('|'),
  () => {
    void hydrateCardImages()
  },
  { immediate: true },
)

// --- Editor: drafts (réplica OptionGroupData L1225-1238) -----------------------------

/**
 * Tipo de selección del ORIGINAL (L1025-1030 + default L1229): REQUIRED/
 * OPTIONAL/MULTIPLE con labels EXACTOS. MAPEO al contrato REST en
 * buildPayload: REQUIRED→radio(min1,max1); OPTIONAL→radio(min0,max1);
 * MULTIPLE→checkbox(min/max inputs).
 */
type SelectionType = 'REQUIRED' | 'OPTIONAL' | 'MULTIPLE'

const selectionTypeOptions: AppSelectOption[] = [
  { value: 'REQUIRED', label: 'Obligatorio (1)' },
  { value: 'OPTIONAL', label: 'Opcional' },
  { value: 'MULTIPLE', label: 'Múltiple' },
]

/** Item de catálogo seleccionado (L1110-1125: chips con nombre). */
interface SelectedItem {
  id: number
  nombre: string
}

interface GroupDraft {
  groupName: string
  /** Value EXACTO del dropdown del original (REQUIRED/OPTIONAL/MULTIPLE). */
  selectedType: SelectionType
  /** SOLO se usan cuando selectedType === 'MULTIPLE' (L1036). */
  minSelections: string
  maxSelections: string
  /** Items del catálogo seleccionados en el diálogo (chips removibles). */
  selectedItems: SelectedItem[]
}

interface ProductForm {
  name: string
  description: string
  /** null = 'Sin categoría'/'No seleccionada' (se envía null). */
  categoryId: number | null
  basePrice: string
  isActive: boolean
}

function emptyForm(): ProductForm {
  return {
    name: '',
    description: '',
    categoryId: null,
    basePrice: '0.00',
    isActive: true,
  }
}

/** Grupo nuevo default REQUIRED (OptionGroupData L1229-1232). */
function emptyGroup(): GroupDraft {
  return {
    groupName: '',
    selectedType: 'REQUIRED',
    minSelections: '0',
    maxSelections: '1',
    selectedItems: [],
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

// --- Wizard Stepper (L30 + L676-710) ---------------------------------------------------

const currentStep = ref(0)
const STEP_TITLES = ['Información básica', 'Opciones del producto', 'Revisar y confirmar']

/** onStepContinue L678-684: pasos 0-1 avanzan, paso 2 = submit. */
function onStepContinue(): void {
  if (currentStep.value < 2) {
    currentStep.value += 1
  } else {
    void submitEditor()
  }
}

/** onStepCancel L685-691: paso >0 retrocede, paso 0 cierra el editor. */
function onStepCancel(): void {
  if (currentStep.value > 0) {
    currentStep.value -= 1
  } else {
    closeEditor()
  }
}

// --- Imagen (L880-935): preview local inmediato + subida multipart real ------
//
// Flujo (BE-1):
//  1. Elegir archivo → preview INMEDIATO con objectURL local (el usuario ve su
//     foto al instante, antes de guardar).
//  2. Guardar producto (POST/PUT) → si hay archivo pendiente, subirlo a
//     POST /api/rest/catalog/admin/products/{id}/image (campo `file`).
//  3. Invalidar la caché de object URLs de ese id para que las tarjetas
//     (lista admin y POS) muestren la imagen nueva.
//
// La imagen NUNCA se lee con `<img :src="/api/rest/...">`: ese endpoint exige
// X-Api-Key + Bearer, headers que un <img> no envía. Toda lectura pasa por
// src/api/productImages.ts (descarga autenticada → object URL).

/**
 * Tamaño MÁXIMO aceptado para una imagen de producto: 4 MB.
 *
 * Se valida en el CLIENTE antes de aceptar el archivo (ver onPickImage) porque
 * el body multipart completo debe caber en el límite del servidor: las fotos
 * de celular son rutinariamente 4-8 MB y sin esta pre-validación el usuario
 * recibía un 400 opaco ("No se pudo subir la imagen") sin saber que el
 * problema era el peso.
 *
 * Declarada UNA sola vez: el texto del toast y la comparación la reutilizan.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** Peso en MB con 1 decimal, redondeo normal: 4.7 MB / 0.3 MB / 4 MB. */
function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * Texto del rechazo por peso.
 *
 * El peso del archivo se redondea normal, pero si el redondeo lo iguala al
 * máximo el mensaje se leería contradictorio ("pesa 4 MB y el máximo es 4 MB"
 * para un archivo de 4 194 305 bytes, 1 byte arriba del límite). En ese único
 * caso se sube un decimal, que es lo mínimo para que ambos números no se
 * confundan.
 */
function tooLargeImageMessage(fileSize: number): string {
  const maxLabel = formatMegabytes(MAX_IMAGE_BYTES)
  const rounded = formatMegabytes(fileSize)
  const maxMegabytes = MAX_IMAGE_BYTES / (1024 * 1024)
  const sizeLabel =
    rounded === maxLabel ? `${Math.round((maxMegabytes + 0.1) * 10) / 10} MB` : rounded
  return `La imagen pesa ${sizeLabel} y el máximo es ${maxLabel}. Elige una más pequeña.`
}

const selectedImageName = ref<string | null>(null)
const selectedImageUrl = ref<string | null>(null)
/** Archivo elegido pendiente de subir (null = no hay cambio de imagen). */
const selectedImageFile = ref<File | null>(null)
const brokenEditImage = ref(false)
/** Object URL de la imagen YA guardada del producto en edición (blob cache). */
const editingImageBlobUrl = ref<string | null>(null)
/** Descarga de la imagen guardada en curso (placeholder con spinner). */
const editingImageLoading = ref(false)
/** La imagen guardada no se pudo descargar (fallback ImageOff). */
const editingImageFailed = ref(false)
/** DELETE …/products/{id}/image en curso (deshabilita la acción). */
const removingImage = ref(false)
/** Confirmación abierta de 'Quitar imagen' (patrón AppModal del proyecto). */
const confirmRemoveImageOpen = ref(false)

function revokeSelectedImageUrl(): void {
  if (selectedImageUrl.value != null && selectedImageUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(selectedImageUrl.value)
  }
}

/** Limpia el estado de imagen del editor (File + objectURL local, sin fugas). */
function resetImageState(): void {
  // Solo se revoca el objectURL LOCAL (creado aquí a partir del File). El de
  // la imagen guardada lo posee la caché compartida: revocarlo aquí rompería
  // las miniaturas del listado y del POS, así que solo se suelta la referencia.
  revokeSelectedImageUrl()
  selectedImageName.value = null
  selectedImageUrl.value = null
  selectedImageFile.value = null
  brokenEditImage.value = false
  editingImageBlobUrl.value = null
  editingImageLoading.value = false
  editingImageFailed.value = false
  removingImage.value = false
  confirmRemoveImageOpen.value = false
}

/**
 * Elige una imagen: pre-valida el PESO antes de aceptarla.
 *
 * Por qué en el cliente: el backend responde 400 al exceder 4 MB, pero ese
 * error genérico no le dice al usuario qué hacer. Aquí el archivo simplemente
 * NO se acepta (no se selecciona nada, no se marca nada como guardado) y se
 * explica el peso real contra el máximo.
 */
function onPickImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file == null) return
  if (file.size > MAX_IMAGE_BYTES) {
    // Limpia el input para poder re-elegir el MISMO archivo (o corregirlo).
    input.value = ''
    toast.warning(tooLargeImageMessage(file.size))
    return
  }
  // Liberar el objectURL local anterior antes de crear el nuevo.
  revokeSelectedImageUrl()
  selectedImageName.value = file.name
  selectedImageFile.value = file
  selectedImageUrl.value = URL.createObjectURL(file)
  brokenEditImage.value = false
  // Permitir re-seleccionar el mismo archivo.
  input.value = ''
}

/** ¿Hay imagen que mostrar en el preview? (nueva o la guardada del producto). */
const hasEditorImage = computed(
  () =>
    selectedImageUrl.value != null ||
    (editingProduct.value?.imageUrl ?? '') !== '',
)

/**
 * Fuente del preview: primero el objectURL local (inmediato); si no, la imagen
 * guardada descargada como blob (el endpoint necesita auth).
 */
const editorImageSrc = computed(() => {
  if (selectedImageUrl.value != null) return selectedImageUrl.value
  return editingImageBlobUrl.value
})

const editorImageLabel = computed(() =>
  hasEditorImage.value ? 'Cambiar imagen' : 'Seleccionar imagen',
)

/**
 * ¿Se puede "quitar" la imagen? SOLO en edición y SOLO si el producto YA tiene
 * una imagen guardada (`imageUrl` no vacío): el backend interpreta
 * `imageUrl == null` como "no cambiar", así que sin esta acción el usuario
 * únicamente podía REEMPLAZAR la foto, nunca dejarla sin imagen.
 */
const canRemoveImage = computed(
  () =>
    editingProduct.value != null && (editingProduct.value.imageUrl ?? '') !== '',
)

function openRemoveImageConfirm(): void {
  if (!canRemoveImage.value || removingImage.value) return
  confirmRemoveImageOpen.value = true
}

function closeRemoveImageConfirm(): void {
  if (removingImage.value) return
  confirmRemoveImageOpen.value = false
}

/**
 * DELETE …/admin/products/{id}/image (borra la imagen guardada).
 *
 * Orden del éxito (el mismo cuidado que en refreshCardImage, para no revocar un
 * blob todavía pintado por un `<img>` → dispararía @error y mostraría el
 * fallback en un producto que ya no tiene imagen):
 *   1. Soltar las referencias del DOM (miniatura del listado + preview del
 *      editor) y limpiar el estado local.
 *   2. `await nextTick()`: Vue ya parcheó el DOM, ningún `<img>` apunta al blob.
 *   3. `invalidateProductImage` → revoca el object URL borrado y olvida la
 *      entrada de caché.
 *   4. Recargar el listado con los datos reales del servidor.
 *
 * En error NO se toca el estado local: la imagen sigue existiendo.
 */
async function confirmRemoveImage(): Promise<void> {
  const product = editingProduct.value
  if (product == null || removingImage.value) return
  const productId = product.id
  removingImage.value = true
  try {
    await deleteAdminProductImage(productId)
    confirmRemoveImageOpen.value = false
    // La miniatura del listado sale del DOM siempre (la imagen ya no existe en
    // el servidor), aunque el editor se haya cerrado/cambiado mientras tanto.
    dropCardImage(productId)
    // Estado del editor: SOLO si sigue siendo el mismo producto. Si el usuario
    // cerró el editor o abrió otro durante el DELETE, tocarlo borraría el
    // preview de un producto distinto.
    if (editingProduct.value?.id === productId) {
      // Si además había una imagen nueva pendiente (elegida pero sin guardar),
      // se descarta: el usuario acaba de pedir "sin imagen", y al guardar no
      // debe re-subirse la que iba a reemplazarla.
      revokeSelectedImageUrl()
      selectedImageName.value = null
      selectedImageUrl.value = null
      selectedImageFile.value = null
      // El editor deja de mostrar la imagen (preview + fallback + spinner).
      product.imageUrl = null
      editingImageBlobUrl.value = null
      editingImageFailed.value = false
      editingImageLoading.value = false
      brokenEditImage.value = false
    }
    // Esperar el patch antes de revocar: ningún `<img>` debe seguir apuntando
    // al blob borrado (revocarlo antes dispararía @error).
    await nextTick()
    // La caché olvida el blob borrado (revoca el object URL).
    invalidateProductImage(productId)
    // El listado vuelve a pintar el dato del servidor (sin bloque de imagen).
    await productsStore.loadProducts(true)
    toast.success('Imagen eliminada')
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    removingImage.value = false
  }
}

/** Descarga (vía caché) la imagen guardada del producto en edición. */
function loadEditingImage(product: RestAdminProduct | null): void {
  editingImageBlobUrl.value = null
  editingImageFailed.value = false
  editingImageLoading.value = false
  if (product == null || (product.imageUrl ?? '') === '') return
  const productId = product.id
  editingImageLoading.value = true
  void loadProductImage(productId).then((url) => {
    // Ignora respuestas viejas si el editor ya cambió de producto.
    if (editingProduct.value?.id !== productId) return
    editingImageBlobUrl.value = url
    editingImageFailed.value = url == null
    editingImageLoading.value = false
  })
}

const editorTitle = computed(() =>
  // UI-parity create_product_template.dart L665 (textos EXACTOS).
  editingProduct.value == null ? 'Crear Nuevo Producto' : 'Editar Producto',
)

function openCreate(): void {
  Object.assign(form, emptyForm())
  formScope.value = { scopeType: 'GLOBAL', plantId: null }
  // Réplica L43: optionGroups EMPIEZA VACÍO (el editor previo creaba uno).
  groups.value = []
  resetImageState()
  currentStep.value = 0
  editingProduct.value = null
  editorOpen.value = true
}

function openEdit(product: RestAdminProduct): void {
  editingProduct.value = product
  Object.assign(form, {
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId ?? null,
    basePrice: product.basePrice.toFixed(2),
    isActive: product.isActive,
  })
  const s = product.scopes?.[0]
  formScope.value =
    s == null
      ? { scopeType: 'GLOBAL', plantId: null }
      : { scopeType: s.scopeType, plantId: s.scopeType === 'PLANT' ? (s.plantId ?? null) : null }
  // Precarga de grupos réplica L107-130 + mapeo INVERSO de tipo (doc arriba):
  // radio min>=1 → REQUIRED, radio min=0 → OPTIONAL, checkbox → MULTIPLE.
  groups.value = (product.optionGroups ?? []).map((g) => {
    const selectedItems: SelectedItem[] = g.values.map((v) => ({
      id: v.catalogItemId,
      // El nombre real se resuelve contra el store en chipsNameOf; el
      // fallback mantiene el valor visible aunque el item no venga.
      nombre: catalogItemsStore.items.find((it) => it.id === v.catalogItemId)?.nombre ?? `Item #${v.catalogItemId}`,
    }))
    let selectedType: SelectionType = 'MULTIPLE'
    if (g.groupType === 'radio') {
      selectedType = g.minSelections >= 1 ? 'REQUIRED' : 'OPTIONAL'
    }
    return {
      groupName: g.groupName,
      selectedType,
      minSelections: String(g.minSelections),
      maxSelections: String(g.maxSelections),
      selectedItems,
    }
  })
  selectedImageFile.value = null
  // Sin restos del producto anterior (File + objectURL local) antes de cargar.
  resetImageState()
  // Imagen guardada del producto (descarga autenticada → object URL).
  loadEditingImage(product)
  currentStep.value = 0
  editorOpen.value = true
}

function closeEditor(): void {
  if (submitting.value) return
  // Sin fugas: revoca el objectURL local y descarta el File pendiente.
  resetImageState()
  editorOpen.value = false
  editingProduct.value = null
  groups.value = []
  currentStep.value = 0
}

// --- Opciones de los AppSelect -------------------------------------------------------

const categoryOptions = computed<AppSelectOption[]>(() =>
  // Categorías filtradas por el alcance del paso 1 (L173-247: el original
  // recarga por alcance con la MISMA _loadData que los items — filtro
  // JERÁRQUICO, ver scopedCatalogItems; store intacto).
  scopedCategories.value.map((c) => ({ value: c.id, label: c.nombre })),
)

// --- Catálogo del diálogo filtrado por alcance (L173-247, JERÁRQUICO) -----------------

/**
 * Filtro JERÁRQUICO réplica _loadData L196-201 del original: con alcance
 * PLANT pide catálogo CON plantId y el backend devuelve el jerárquico
 * (GLOBAL + SUCURSAL + ese piso, NUNCA otros pisos); con GLOBAL/SUCURSAL
 * pide SIN plantId y devuelve TODO. El EDITOR NO usa el filtro EXACTO de
 * scope_filter.dart de la LISTA (ese es para el listado; aquí la vista del
 * diálogo replica lo que el backend entrega por petición):
 * - GLOBAL o SUCURSAL → TODOS los items (sin filtro de scope, solo dedup).
 * - PLANT N → sin-scope (siempre visible) OR GLOBAL OR SUCURSAL OR
 *   ('PLANT' && plantId==N); dedup por id. 100% client-side (el store carga
 *   todo; NO se cambia stores ni API). Items ya seleccionados fuera del
 *   alcance NO se remueven (comportamiento original).
 */
const scopedCatalogItems = computed(() => {
  const { scopeType, plantId } = formScope.value
  const seen = new Set<number>()
  const result: RestAdminCatalogItem[] = []
  const isPlant = scopeType === 'PLANT' && plantId != null
  for (const item of catalogItemsStore.items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    if (!isPlant) {
      // GLOBAL/SUCURSAL → el original pide TODO (sin plantId en la query).
      result.push(item)
      continue
    }
    const s = item.scopes?.[0]
    if (s == null || s.scopeType.trim() === '') {
      result.push(item)
      continue
    }
    if (s.scopeType === 'GLOBAL' || s.scopeType === 'SUCURSAL') {
      result.push(item)
    } else if (s.scopeType === 'PLANT' && s.plantId === plantId) {
      result.push(item)
    }
  }
  return result
})

const scopedCategories = computed(() => {
  const { scopeType, plantId } = formScope.value
  const seen = new Set<number>()
  const result: RestAdminCategory[] = []
  const isPlant = scopeType === 'PLANT' && plantId != null
  for (const cat of categoriesStore.categories) {
    if (seen.has(cat.id)) continue
    seen.add(cat.id)
    if (!isPlant) {
      // GLOBAL/SUCURSAL → TODO (misma _loadData que los items).
      result.push(cat)
      continue
    }
    const s = cat.scopes?.[0]
    if (s == null || s.scopeType.trim() === '') {
      result.push(cat)
      continue
    }
    if (s.scopeType === 'GLOBAL' || s.scopeType === 'SUCURSAL') {
      result.push(cat)
    } else if (s.scopeType === 'PLANT' && s.plantId === plantId) {
      result.push(cat)
    }
  }
  return result
})

/**
 * Agrupado por tipo réplica _groupCatalogItems L151-171: orden de grupos =
 * orden de aparición en los datos (Map iteration), items alfabético por
 * nombre dentro de cada grupo.
 */
const catalogItemsByType = computed<Array<{ tipo: string; items: RestAdminCatalogItem[] }>>(() => {
  const grouped = new Map<string, RestAdminCatalogItem[]>()
  for (const item of scopedCatalogItems.value) {
    const tipo = item.tipo != null && item.tipo !== '' ? item.tipo : 'Otro'
    const list = grouped.get(tipo)
    if (list != null) list.push(item)
    else grouped.set(tipo, [item])
  }
  for (const list of grouped.values()) {
    list.sort((a, b) =>
      a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()),
    )
  }
  return Array.from(grouped.entries()).map(([tipo, items]) => ({ tipo, items }))
})

// --- Diálogo de items (L278-498): draft local aplicado al Guardar --------------------

const dialogOpen = ref(false)
const dialogGroupIndex = ref(-1)
/** Draft local de ids seleccionados (Cancelar no cambia nada). */
const dialogDraft = ref<Set<number>>(new Set())

function openItemDialog(gi: number): void {
  const g = groups.value[gi]
  if (g == null) return
  dialogGroupIndex.value = gi
  dialogDraft.value = new Set(g.selectedItems.map((it) => it.id))
  dialogOpen.value = true
}

function closeItemDialog(): void {
  dialogOpen.value = false
  dialogGroupIndex.value = -1
  dialogDraft.value = new Set()
}

/** Guardar selección: aplica el draft al grupo (réplica semántica L317-321). */
function applyItemDialog(): void {
  const g = groups.value[dialogGroupIndex.value]
  if (g != null) {
    const byId = new Map(catalogItemsStore.items.map((it) => [it.id, it]))
    g.selectedItems = Array.from(dialogDraft.value).map((id) => ({
      id,
      nombre: byId.get(id)?.nombre ?? `Item #${id}`,
    }))
  }
  closeItemDialog()
}

function toggleDialogItem(itemId: number): void {
  const next = new Set(dialogDraft.value)
  if (next.has(itemId)) next.delete(itemId)
  else next.add(itemId)
  dialogDraft.value = next
}

/**
 * Toggle 'Todos' de una categoría (L392-416): si todos seleccionados →
 * deselecciona todos; si no → añade los faltantes.
 */
function toggleDialogAll(tipo: string): void {
  const items = catalogItemsByType.value.find((e) => e.tipo === tipo)?.items ?? []
  const next = new Set(dialogDraft.value)
  const allSelected = items.every((it) => next.has(it.id))
  if (allSelected) {
    for (const it of items) next.delete(it.id)
  } else {
    for (const it of items) next.add(it.id)
  }
  dialogDraft.value = next
}

function isDialogAllSelected(tipo: string): boolean {
  const items = catalogItemsByType.value.find((e) => e.tipo === tipo)?.items ?? []
  return items.length > 0 && items.every((it) => dialogDraft.value.has(it.id))
}

/** Chip removible del grupo (L1117-1121: remove del item). */
function removeSelectedItem(gi: number, itemId: number): void {
  const g = groups.value[gi]
  if (g == null) return
  g.selectedItems = g.selectedItems.filter((it) => it.id !== itemId)
}

// --- Mutación de grupos ---------------------------------------------------------------

function addGroup(): void {
  groups.value.push(emptyGroup())
}

function removeGroup(gi: number): void {
  groups.value.splice(gi, 1)
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

/** Solo dígitos (min/max del grupo MULTIPLE). */
function sanitizeDigits(value: string): string {
  return value.replace(/\D/g, '')
}

// --- Resumen paso 3 (L1136-1211) -------------------------------------------------------

const categoryNameOf = computed(() => {
  const id = form.categoryId
  if (id == null) return 'No seleccionada'
  const cat = categoriesStore.categories.find((c) => c.id === id)
  return cat != null ? cat.nombre : `Categoría #${id}`
})

// --- Validación + submit (textos EXACTOS L500-545) --------------------------------------

function validateForm(): boolean {
  // Orden EXACTO del original (create_product_template.dart L501-545):
  // nombre → categoría → grupos (al menos uno) → piso → grupo i sin items.
  if (form.name.trim().length === 0) {
    toast.warning('El nombre del producto es requerido')
    return false
  }
  // L508-517: categoría requerida. El 0 es 'Sin categoría' del AppSelect
  // heredado — tratarlo como NO seleccionada (el original valida null).
  if (form.categoryId == null || form.categoryId === 0) {
    toast.warning('Debe seleccionar una categoría')
    return false
  }
  // Extra local (el original no la tiene, no daña): precio >= 0.
  const price = Number.parseFloat(form.basePrice)
  if (!Number.isFinite(price) || price < 0) {
    toast.warning('El precio debe ser mayor o igual a 0')
    return false
  }
  if (groups.value.length === 0) {
    toast.warning('Debe agregar al menos un grupo de opciones')
    return false
  }
  // L527-534.
  if (formScope.value.scopeType === 'PLANT' && formScope.value.plantId == null) {
    toast.warning('Selecciona un piso para el alcance')
    return false
  }
  // L536-545.
  for (let gi = 0; gi < groups.value.length; gi += 1) {
    const g = groups.value[gi]
    if (g.selectedItems.length === 0) {
      toast.warning(`El grupo ${gi + 1} no tiene items seleccionados`)
      return false
    }
  }
  return true
}

/**
 * Mapeo del tipo del ORIGINAL al contrato REST (doc del script):
 * REQUIRED→radio min1 max1; OPTIONAL→radio min0 max1; MULTIPLE→checkbox
 * con min/max de los inputs. Los values son los items seleccionados del
 * grupo (priceModifier null en el original → 0; displayOrder = índice).
 */
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
    // Eco de la imageUrl VIGENTE: el backend trata `null` como "no cambiar",
    // pero se mantiene el valor real para no depender de esa tolerancia.
    imageUrl: editingProduct.value?.imageUrl ?? null,
    scopeType: formScope.value.scopeType,
    sucursalId: POS_SUCURSAL_ID,
    plantId: formScope.value.scopeType === 'PLANT' ? formScope.value.plantId : null,
    optionGroups: groups.value.map((g, gi) => {
      const isMultiple = g.selectedType === 'MULTIPLE'
      return {
        groupName: g.groupName.trim(),
        groupType: isMultiple ? 'checkbox' : 'radio',
        minSelections: isMultiple
          ? Number.parseInt(g.minSelections, 10) || 0
          : g.selectedType === 'REQUIRED'
            ? 1
            : 0,
        maxSelections: isMultiple
          ? Number.parseInt(g.maxSelections, 10) || 0
          : 1,
        displayOrder: gi + 1,
        values: g.selectedItems.map((it, vi) => ({
          catalogItemId: it.id,
          priceModifier: 0,
          displayOrder: vi + 1,
          isDefault: false,
        })),
      }
    }),
  }
}

/**
 * Texto genérico que apiUpload usa cuando el cuerpo del error no trae mensaje
 * (p.ej. un ProblemDetails de ASP.NET, que responde `title`/`detail`/`errors[]`
 * en vez de `message`). Se reconoce para NO mostrarlo como si fuera del
 * servidor y responder con algo accionable.
 */
const UPLOAD_GENERIC_FALLBACK = 'No se pudo subir la imagen. Intenta de nuevo.'

/**
 * Mensaje del error de subida.
 *
 * El caso frecuente es el PESO (fotos de celular 4-8 MB): si el backend o un
 * proxy rechazan el archivo por tamaño, el usuario debe leerlo así y no
 * "No se pudo subir la imagen".
 *  · 413 → payload too large (Kestrel/nginx): mensaje de tamaño.
 *  · 400 → el mensaje del servidor tal cual (los 400 de este endpoint son
 *    descriptivos); si viene vacío/genérico (ProblemDetails) se responde con
 *    formato + tamaño, que son los únicos 400 posibles del endpoint.
 * El resto de estados conserva el comportamiento anterior.
 */
function uploadErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError) || err.status === 0) {
    return 'No se pudo conectar con el servidor. Verifica tu conexión.'
  }
  const maxLabel = formatMegabytes(MAX_IMAGE_BYTES)
  if (err.status === 413) {
    return `La imagen excede el tamaño máximo de ${maxLabel}. Elige una más pequeña.`
  }
  const serverMessage = err.message.trim()
  const hasServerMessage =
    serverMessage !== '' && serverMessage !== UPLOAD_GENERIC_FALLBACK
  if (err.status === 400) {
    return hasServerMessage
      ? serverMessage
      : `La imagen no se pudo procesar: debe ser una imagen válida de máximo ${maxLabel}.`
  }
  return hasServerMessage ? serverMessage : UPLOAD_GENERIC_FALLBACK
}

async function submitEditor(): Promise<void> {
  if (submitting.value || !validateForm()) return
  submitting.value = true
  try {
    const payload = buildPayload()
    // Archivo pendiente de subir (null = no se cambió la imagen).
    const pendingFile = selectedImageFile.value
    let productId: number

    if (editingProduct.value == null) {
      // El id es necesario para el POST de la imagen (…/products/{id}/image).
      productId = await productsStore.createProduct(payload)
      // Texto EXACTO L629-631.
      toast.success('Producto creado exitosamente')
    } else {
      productId = editingProduct.value.id
      await productsStore.updateProduct(productId, {
        ...payload,
        isActive: form.isActive,
      })
      // Texto EXACTO L608-610.
      toast.success('Producto actualizado exitosamente')
    }

    if (pendingFile != null && productId > 0) {
      try {
        await uploadAdminProductImage(productId, pendingFile)
        await productsStore.loadProducts(true)
        // Suelta el blob local ANTES de que la caché revoque los object URLs
        // (un <img> que referencia un blob revocado dispara @error).
        resetImageState()
        // Re-sincroniza la miniatura: suelta el object URL del DOM, espera el
        // patch, invalida la caché y re-descarga una sola vez.
        await refreshCardImage(productId)
      } catch (err) {
        // El producto YA se guardó: la subida es un paso posterior. Se avisa
        // con claridad y NO se marca el guardado como fallido (ni se pierde el
        // producto). El editor se cierra: el catálogo ya quedó guardado.
        toast.error(
          `Producto guardado, pero la imagen no se pudo subir: ${uploadErrorMessage(err)}`,
        )
      }
    } else if (pendingFile != null) {
      // Sin id del backend no hay endpoint de imagen al que apuntar: el
      // producto SÍ se guardó, así que se avisa sin marcar el guardado como
      // fallido.
      toast.error(
        'Producto guardado, pero la imagen no se pudo subir: el servidor no devolvió el identificador del producto.',
      )
    }

    // El original espera 1.5s antes de pop (L642) — NO replicado: cierre
    // normal, el store ya recargó la lista.
    resetImageState()
    editorOpen.value = false
    editingProduct.value = null
    groups.value = []
    currentStep.value = 0
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
    toast.success('Template eliminado')
    confirmTarget.value = null
  } catch (err) {
    // Réplica L97: '❌ Error: …'.
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
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
        data-testid="pe-appbar-back"
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
                 imageUrl vacía/null → SIN bloque de imagen. El src es un object
                 URL de la descarga autenticada (un <img> no puede mandar
                 X-Api-Key/Bearer). -->
            <span
              v-if="product.imageUrl != null && product.imageUrl !== ''"
              class="pe-card-media"
            >
              <img
                v-if="cardImageSrc(product.id) != null && !brokenImageIds.has(product.id)"
                :src="cardImageSrc(product.id) ?? undefined"
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

      <!-- ====================== EDITOR (pantalla completa) ======================
           Wizard de 3 pasos réplica EXACTA del Stepper de
           create_product_template.dart (L676-710): Continue avanza (paso 2 =
           submit), Cancel retrocede (paso 0 cierra). Mientras isLoading el
           original muestra spinner en todo el body (L667-668).
      -->
      <div v-else class="pe-editor" data-testid="pe-editor">
        <!-- Submitting: spinner full-body (réplica L667-668) -->
        <div v-if="submitting" class="pe-editor-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <template v-else>
          <!-- ===== Stepper (L676-710): círculos numerados + conector ===== -->
          <ol class="pe-stepper">
            <li
              v-for="(stepTitle, step) in STEP_TITLES"
              :key="step"
              class="pe-step"
              :data-testid="`pe-step-${step}`"
            >
              <div class="pe-step-head">
                <!-- Columna del indicador: círculo + conector vertical debajo -->
                <div class="pe-step-rail" aria-hidden="true">
                  <span
                    class="pe-step-ind"
                    :class="{
                      'pe-step-ind--active': currentStep === step,
                      'pe-step-ind--done': currentStep > step,
                    }"
                  >{{ step + 1 }}</span>
                  <span v-if="step < 2" class="pe-step-line"></span>
                </div>
                <!-- Título SIEMPRE visible (pasos previos quedan colapsados) -->
                <span
                  class="pe-step-title"
                  :class="{ 'pe-step-title--active': currentStep === step }"
                >{{ stepTitle }}</span>
              </div>

              <!-- Contenido SOLO del paso corriente -->
              <div v-if="currentStep === step" class="pe-step-body">
                <!-- ============ Paso 1 'Información básica' (L714-939) ============ -->
                <template v-if="step === 0">
                  <!-- Panel Alcance: radius 12 (L720-756), NO el radius 10 de la lista -->
                  <div class="pe-scope-panel-editor">
                    <p class="pe-scope-title-editor">Alcance del template</p>
                    <ScopeSelector v-model="formScope" />
                  </div>

                  <div class="pe-field">
                    <label class="pe-label" for="pe-name">Nombre del producto</label>
                    <input
                      id="pe-name"
                      v-model="form.name"
                      type="text"
                      class="pe-input"
                      placeholder="Ej: Charola Chica"
                      data-testid="pe-name"
                      autocomplete="off"
                    />
                  </div>

                  <div class="pe-field">
                    <label class="pe-label" for="pe-desc">Descripción</label>
                    <textarea
                      id="pe-desc"
                      v-model="form.description"
                      class="pe-input pe-textarea"
                      rows="3"
                      placeholder="Describe el producto..."
                      data-testid="pe-desc"
                    ></textarea>
                  </div>

                  <div class="pe-field">
                    <label class="pe-label" for="pe-price">Precio base</label>
                    <div class="pe-input-wrap">
                      <span class="pe-prefix">$</span>
                      <input
                        id="pe-price"
                        v-model="form.basePrice"
                        type="text"
                        inputmode="decimal"
                        class="pe-input pe-input--prefixed"
                        placeholder="0.00"
                        data-testid="pe-price"
                        @input="sanitizePrecio"
                      />
                    </div>
                  </div>

                  <div class="pe-field">
                    <label class="pe-label" id="pe-category-label" for="pe-category">Categoría</label>
                    <AppSelect
                      v-model="form.categoryId"
                      :options="categoryOptions"
                      placeholder="Seleccionar categoría"
                      testid="pe-category"
                      aria-label="Categoría"
                    />
                  </div>

                  <!-- Imagen (L880-935): container border deepOrange radius 12,
                       preview 200px cover radius 10 (fallback grey800+ImageOff),
                       botón deepOrange. El archivo elegido se ve al instante
                       (objectURL local) y se sube multipart al guardar el
                       producto; la imagen guardada se lee por descarga
                       autenticada → object URL (productImages.ts). -->
                  <div class="pe-field">
                    <span class="pe-label" id="pe-image-label">Imagen</span>
                    <div class="pe-image-box">
                      <img
                        v-if="hasEditorImage && !brokenEditImage && editorImageSrc != null"
                        :src="editorImageSrc"
                        :alt="selectedImageName != null ? `Vista previa de ${selectedImageName}` : 'Vista previa de la imagen del producto'"
                        class="pe-image-preview"
                        data-testid="pe-image-preview"
                        @error="brokenEditImage = true"
                      />
                      <div
                        v-else-if="hasEditorImage && (brokenEditImage || editingImageFailed)"
                        class="pe-image-fallback"
                        data-testid="pe-image-fallback"
                      >
                        <ImageOff :size="40" aria-hidden="true" />
                      </div>
                      <!-- Descargando la imagen guardada (el endpoint exige auth):
                           placeholder con spinner, sin bloquear el resto del form -->
                      <div
                        v-else-if="editingImageLoading && selectedImageUrl == null"
                        class="pe-image-fallback"
                        data-testid="pe-image-loading"
                      >
                        <AppSpinner :size="28" tone="primary" />
                      </div>
                      <input
                        id="pe-image-input"
                        type="file"
                        accept="image/*"
                        class="pe-image-input"
                        data-testid="pe-image-input"
                        tabindex="-1"
                        aria-hidden="true"
                        @change="onPickImage"
                      />
                      <div class="pe-image-actions">
                        <label
                          for="pe-image-input"
                          class="pe-btn pe-btn--accent pe-image-btn"
                          data-testid="pe-image"
                          tabindex="0"
                        >
                          <ImageIcon :size="18" aria-hidden="true" />
                          {{ editorImageLabel }}
                        </label>
                        <!-- Quitar imagen: SOLO en edición con imagen guardada.
                             Ghost (secundario + token de peligro al hover): el
                             CTA de la pantalla es Guardar, no esta acción. -->
                        <button
                          v-if="canRemoveImage"
                          type="button"
                          class="pe-btn pe-btn--ghost pe-btn--small pe-image-remove"
                          data-testid="pe-image-remove"
                          :disabled="removingImage"
                          @click="openRemoveImageConfirm"
                        >
                          <Trash2 :size="16" aria-hidden="true" />
                          Quitar imagen
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Activo SOLO en editar (se conserva del editor previo) -->
                  <label v-if="editingProduct != null" class="pe-switch" data-testid="pe-activo">
                    <input v-model="form.isActive" type="checkbox" />
                    <span class="pe-switch-track" aria-hidden="true"></span>
                    <span class="pe-switch-label">Activo</span>
                  </label>
                </template>

                <!-- ============ Paso 2 'Opciones del producto' (L941-1134) ============ -->
                <template v-else-if="step === 1">
                  <section class="pe-groups" data-testid="pe-groups">
                    <h2 class="pe-groups-title">Grupos de opciones</h2>

                    <!-- L952-957: grupos empiezan VACÍOS -->
                    <p v-if="groups.length === 0" class="pe-groups-empty" data-testid="pe-groups-empty">
                      No hay grupos agregados. Haz clic en "Agregar grupo"
                    </p>

                    <!-- Card por grupo grey[850] #303030 (L978-1134) -->
                    <div
                      v-for="(g, gi) in groups"
                      :key="gi"
                      class="pe-group-card"
                      :data-testid="`pe-group-${gi}`"
                    >
                      <!-- Row: nombre + delete rojo (L984-1000) -->
                      <div class="pe-group-head">
                        <input
                          v-model="g.groupName"
                          type="text"
                          class="pe-input pe-group-name"
                          placeholder="Nombre del grupo (ej: Tipo de Carne)"
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

                      <!-- Tipo de selección (L1018-1030): labels EXACTOS -->
                      <div class="pe-field">
                        <label class="pe-label" :for="`pe-group-type-${gi}`">Tipo de selección</label>
                        <AppSelect
                          v-model="g.selectedType"
                          :options="selectionTypeOptions"
                          :testid="`pe-group-type-${gi}`"
                          :aria-label="`Tipo de selección del grupo ${gi + 1}`"
                        />
                      </div>

                      <!-- Min/Max SOLO en MULTIPLE (L1036-1062) -->
                      <div v-if="g.selectedType === 'MULTIPLE'" class="pe-group-minmax">
                        <div class="pe-field">
                          <label class="pe-label" :for="`pe-group-min-${gi}`">Mín. selecciones</label>
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
                          <label class="pe-label" :for="`pe-group-max-${gi}`">Máx. selecciones</label>
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
                      </div>

                      <!-- Items del catálogo (L1076-1134): botón → diálogo + chips -->
                      <div class="pe-field">
                        <span class="pe-label pe-label--bold">Items del catálogo</span>
                        <div class="pe-items-box">
                          <button
                            type="button"
                            class="pe-btn pe-btn--accent pe-btn--small"
                            :data-testid="`pe-add-items-${gi}`"
                            @click="openItemDialog(gi)"
                          >
                            <Plus :size="16" aria-hidden="true" />
                            Agregar items
                          </button>

                          <!-- Chips removibles deepOrange α0.3 (L1110-1125) -->
                          <div
                            v-if="g.selectedItems.length > 0"
                            class="pe-chips"
                            :data-testid="`pe-chips-${gi}`"
                          >
                            <span
                              v-for="item in g.selectedItems"
                              :key="item.id"
                              class="pe-chip"
                              :data-testid="`pe-chip-${gi}-${item.id}`"
                            >
                              {{ item.nombre }}
                              <button
                                type="button"
                                class="pe-chip-remove"
                                :aria-label="`Quitar ${item.nombre} del grupo ${gi + 1}`"
                                @click="removeSelectedItem(gi, item.id)"
                              >
                                <X :size="14" aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                          <p v-else class="pe-chips-empty">Sin items seleccionados</p>
                        </div>
                      </div>
                    </div>

                    <!-- L964-972: botón final deepOrange -->
                    <button
                      type="button"
                      class="pe-btn pe-btn--accent"
                      data-testid="pe-add-group"
                      @click="addGroup"
                    >
                      <Plus :size="18" aria-hidden="true" />
                      Agregar grupo de opciones
                    </button>
                  </section>
                </template>

                <!-- ============ Paso 3 'Revisar y confirmar' (L1136-1211) ============ -->
                <template v-else>
                  <div class="pe-summary" data-testid="pe-summary">
                    <!-- Card 'Información básica' grey[850] -->
                    <div class="pe-summary-card">
                      <h3 class="pe-summary-title">Información básica</h3>
                      <div class="pe-summary-row">
                        <span class="pe-summary-label">Nombre:</span>
                        <span class="pe-summary-value">{{ form.name || '—' }}</span>
                      </div>
                      <div class="pe-summary-row">
                        <span class="pe-summary-label">Descripción:</span>
                        <span class="pe-summary-value">{{ form.description || '—' }}</span>
                      </div>
                      <div class="pe-summary-row">
                        <span class="pe-summary-label">Precio:</span>
                        <span class="pe-summary-value">$ {{ form.basePrice }}</span>
                      </div>
                      <div class="pe-summary-row">
                        <span class="pe-summary-label">Categoría:</span>
                        <span class="pe-summary-value" data-testid="pe-summary-category">{{ categoryNameOf }}</span>
                      </div>
                      <div v-if="hasEditorImage" class="pe-summary-row">
                        <span class="pe-summary-label">Imagen:</span>
                        <span class="pe-summary-value">Seleccionada</span>
                      </div>
                    </div>

                    <!-- Card 'Grupos de opciones': value del dropdown (REQUIRED/
                         OPTIONAL/MULTIPLE), NO el label; '(Sin nombre)' si vacío -->
                    <div class="pe-summary-card" data-testid="pe-summary-groups">
                      <h3 class="pe-summary-title">Grupos de opciones</h3>
                      <div
                        v-for="(g, gi) in groups"
                        :key="gi"
                        class="pe-summary-row"
                        :data-testid="`pe-summary-group-${gi}`"
                      >
                        <span class="pe-summary-label">{{ g.groupName.trim() !== '' ? g.groupName : '(Sin nombre)' }}:</span>
                        <span class="pe-summary-value">{{ g.selectedType }}</span>
                      </div>
                    </div>

                    <!-- L1161-1164: mismo texto en crear y editar -->
                    <p class="pe-confirm-question" data-testid="pe-confirm-question">
                      ¿Confirmas crear este producto?
                    </p>
                  </div>
                </template>
              </div>
            </li>
          </ol>

          <!-- ===== Botones del wizard (Continue/Cancel del Stepper) ===== -->
          <div class="pe-editor-actions">
            <button
              type="button"
              class="pe-btn pe-btn--ghost"
              data-testid="pe-back"
              @click="onStepCancel"
            >
              {{ currentStep > 0 ? 'Atrás' : 'Cancelar' }}
            </button>
            <button
              type="button"
              class="pe-btn pe-btn--accent"
              data-testid="pe-next"
              @click="onStepContinue"
            >
              Continuar
            </button>
          </div>
        </template>
      </div>
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

    <!-- ===== Confirm de 'Quitar imagen' (mismo patrón que el confirm de
         eliminación de template) ===== -->
    <AppModal
      v-if="confirmRemoveImageOpen"
      title="Quitar imagen"
      :width="400"
      @close="closeRemoveImageConfirm"
    >
      <p class="pe-confirm-text" data-testid="pe-image-remove-confirm-text">
        ¿Quitar la imagen de este producto? El producto se guardará sin foto.
      </p>
      <template #footer>
        <button
          type="button"
          class="pe-btn pe-btn--ghost"
          data-testid="pe-image-remove-cancel"
          :disabled="removingImage"
          @click="closeRemoveImageConfirm"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pe-btn pe-btn--danger"
          data-testid="pe-image-remove-confirm"
          :disabled="removingImage"
          @click="confirmRemoveImage"
        >
          Quitar imagen
        </button>
      </template>
    </AppModal>

    <!-- ===== Diálogo de items del catálogo (L278-498) — lo que pidió el
         usuario: items AGRUPADOS por tipo con FilterChips/checks + botón
         'Todos' por categoría. Draft local aplicado al Guardar. ===== -->
    <AppModal
      v-if="dialogOpen"
      title="Seleccionar items del catálogo"
      :width="560"
      @close="closeItemDialog"
    >
      <div class="pe-dialog-scroll" data-testid="pe-dialog">
        <!-- Sin items para el alcance (L303) / cargando (L302) -->
        <p
          v-if="catalogItemsByType.length === 0"
          class="pe-dialog-empty"
          data-testid="pe-dialog-empty"
        >
          {{ catalogItemsStore.loading ? 'Cargando catálogo...' : 'No hay items disponibles para este alcance. Revisa el piso o el scope seleccionado.' }}
        </p>

        <section
          v-for="entry in catalogItemsByType"
          :key="entry.tipo"
          class="pe-dialog-cat"
          :data-testid="`pe-dialog-cat-${entry.tipo}`"
        >
          <!-- Header por categoría (L377-391): chip deepOrange α0.2 + botón Todos -->
          <div class="pe-dialog-cat-head">
            <span class="pe-dialog-cat-chip">{{ entry.tipo }}</span>
            <button
              type="button"
              class="pe-dialog-all"
              :class="{ 'pe-dialog-all--on': isDialogAllSelected(entry.tipo) }"
              :data-testid="`pe-dialog-all-${entry.tipo}`"
              @click="toggleDialogAll(entry.tipo)"
            >
              <CheckSquare
                v-if="isDialogAllSelected(entry.tipo)"
                :size="18"
                aria-hidden="true"
              />
              <Square v-else :size="18" aria-hidden="true" />
              <span>Todos</span>
            </button>
          </div>

          <!-- FilterChips por item (L456-494): label 12px, bg grey[850],
               selected deepOrangeAccent; selección MULTI compartida -->
          <div class="pe-dialog-chips">
            <button
              v-for="item in entry.items"
              :key="item.id"
              type="button"
              class="pe-filterchip"
              :class="{ 'pe-filterchip--on': dialogDraft.has(item.id) }"
              :data-testid="`pe-dialog-item-${item.id}`"
              :aria-pressed="dialogDraft.has(item.id)"
              @click="toggleDialogItem(item.id)"
            >
              {{ item.nombre }}
            </button>
          </div>
        </section>
      </div>

      <template #footer>
        <button
          type="button"
          class="pe-btn pe-btn--ghost"
          data-testid="pe-dialog-cancel"
          @click="closeItemDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pe-btn pe-btn--accent"
          data-testid="pe-dialog-save"
          @click="applyItemDialog"
        >
          Guardar selección
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
  padding: 18px 24px 10px;
  background: var(--bg);

  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.pe-appbar-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: var(--text-h1);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-1);
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

/* En móvil el título cede espacio a la acción primaria (Nuevo Template).
   La acción baja a una segunda fila para no truncar el título. */
@media (max-width: 560px) {
  .pe-appbar {
    flex-wrap: wrap;
    row-gap: 10px;
    padding: 16px 16px 8px;
  }

  .pe-appbar-title {
    flex: 1 1 auto;
    font-size: 19px;
  }

  .pe-appbar-actions {
    flex: 0 0 100%;
    justify-content: flex-end;
  }
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
  background: var(--border-soft);
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
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  min-height: 44px;
}

.pe-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.pe-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.pe-btn--danger {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 40%, transparent);
  color: var(--error);
}

.pe-btn--danger:hover:not(:disabled) {
  border-color: var(--error);
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

/* UI-parity: verde del AppBar (Colors.green var(--success), L122) */
/* 'Crear Template' del empty: superficie con acento (no compite con el CTA) */
.pe-btn--green {
  background: var(--card);
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  color: var(--primary);
}

.pe-btn--green:hover:not(:disabled) {
  background: var(--primary-subtle);
  border-color: var(--primary);
}

/* deepOrangeAccent var(--primary): 'Crear Template' del empty (L250-256) */
.pe-btn--accent {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.pe-btn--accent:hover:not(:disabled) {
  background: var(--primary-hover);
}

/* 'Editar' Colors.blue var(--info) (L414-422) */
.pe-btn--blue {
  background: var(--card);
  border-color: color-mix(in srgb, var(--info) 40%, transparent);
  color: var(--info);
}

.pe-btn--blue:hover:not(:disabled) {
  background: var(--info-soft);
  border-color: var(--info);
}

/* 'Eliminar' — acción destructiva: superficie con acento error */
.pe-btn--red {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 40%, transparent);
  color: var(--error);
}

.pe-btn--red:hover:not(:disabled) {
  border-color: var(--error);
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
  color: var(--text-3); /* Colors.grey.shade600 */
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
  background: var(--elevated); /* fill del tema, igual que el resto de inputs */
  border: 1px solid var(--border-soft);
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
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
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
  background: var(--border-soft);
  color: var(--text);
}

/* ===== No-results con query (L259-265): grey[400], centrado ===== */
.pe-no-results {
  margin: 0;
  padding: 32px 24px;
  text-align: center;
  color: var(--text-2); /* Colors.grey.shade400 */
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

/* ===== Card (L282-437): bg grey[900] var(--bg), radius 12, columna ===== */
.pe-card {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

@media (hover: hover) {
  .pe-card:hover {
    border-color: var(--border);
    background: var(--surface-hover);
  }
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

/* Fallback image_not_supported: container grey[800] var(--bg-surface-2) + icono */
.pe-card-media-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--bg-surface-2); /* Colors.grey.shade800 */
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
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pe-item-name--inactive {
  text-decoration: line-through;
}

/* Precio deepOrangeAccent var(--primary), fontSize 16 bold (L331-333) */
.pe-card-price {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--primary);
}

/* Badge scope: purple900 α0.35 + borde purple700 (L342-355) */
.pe-card-scope {
  flex: none;
  padding: 3px 9px;
  margin-right: 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-3);
  font-size: 11px;
  white-space: nowrap;
}

/* Badge grupos: blue900 α0.3 + borde blue700 (L356-369); 'N grupos' LITERAL
   sin pluralizar ('1 grupos' como el original '${n} grupos' L365) */
.pe-card-groups {
  flex: none;
  padding: 3px 9px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Descripción grey400 13 maxLines 2 (L373-382) */
.pe-card-desc {
  margin: 10px 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.5;
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
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid var(--border-soft);
  color: var(--text-3);
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

/* ===== Editor wizard ===== */
.pe-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

/* Submitting: spinner full-body (réplica L667-668) */
.pe-editor-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
}

/* ===== Stepper (L676-710): círculos + conector vertical ===== */
.pe-stepper {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.pe-step {
  display: flex;
  flex-direction: column;
}

.pe-step-head {
  display: flex;
  align-items: flex-start;
}

/* Columna indicador+conector (el título va a la derecha, como el Stepper) */
.pe-step-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
  width: 28px;
}

/* Indicador circular numerado: activo deepOrangeAccent var(--primary) */
.pe-step-ind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-soft);
  color: var(--text-3);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.pe-step-ind--active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.pe-step-ind--done {
  background: var(--primary-soft);
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
  color: var(--primary);
}

/* Conector vertical entre indicadores (dentro del rail) */
.pe-step-line {
  width: 1px;
  flex: 1;
  min-height: 24px;
  margin: 4px 0;
  background: var(--border-soft);
}

.pe-step-title {
  margin-left: 12px;
  padding-top: 3px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.pe-step-title--active {
  color: var(--text-1);
  font-weight: 600;
}

.pe-step-body {
  padding: 12px 0 0 40px;
}

.pe-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pe-label {
  font-size: 12px;
  color: var(--text-faint);
}

.pe-label--bold {
  font-weight: 700;
  color: var(--text);
  font-size: 13px;
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
  background: var(--elevated);
  border: 1px solid var(--border-soft);
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
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
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
  background: var(--text-2);
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

/* ===== Grupos de opciones (L941-1134) ===== */
.pe-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pe-groups-title {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

/* L952-957 */
.pe-groups-empty {
  margin: 0;
  padding: 16px;
  color: var(--text-muted);
  font-size: 14px;
}

/* Card por grupo: grey[850] var(--bg-surface-2) (L978), padding 16, mb 16 */
.pe-group-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  margin-bottom: 12px;
  border-radius: var(--radius-md);
  background: var(--elevated);
  border: 1px solid var(--border-soft);
}

.pe-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pe-group-name {
  flex: 1;
  min-width: 0;
}

/* Botón icono circular del grupo (delete): patrón .mc-item-btn de
   ManageCatalogView (QA H2: la clase se usaba SIN su CSS — se veía nativo).
   40px transparente, hover white08, --delete rojo (L607 del original). */
.pe-item-btn {
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
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.pe-item-btn:hover {
  background: var(--border-soft);
}

.pe-item-btn--delete {
  color: var(--error);
}

/* min/max SOLO MULTIPLE (L1036) */
.pe-group-minmax {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* Contenedor 'Items del catálogo': border grey700 radius 8 padding 12 */
.pe-items-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid #616161;
  border-radius: 8px;
}

/* Chips removibles deepOrange α0.3 (L1110-1125) */
.pe-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pe-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--primary-soft);
  border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent);
  color: var(--text-1);
  font-size: var(--text-xs);
}

.pe-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease;
}

.pe-chip-remove:hover {
  color: var(--error);
}

/* L1101-1105 */
.pe-chips-empty {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}

/* ===== Resumen paso 3 (L1136-1211): Cards grey[850] ===== */
.pe-summary {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pe-summary-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--elevated);
  border: 1px solid var(--border-soft);
}

.pe-summary-title {
  margin: 0 0 4px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.pe-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.pe-summary-label {
  color: var(--text-muted);
  font-size: 14px;
}

.pe-summary-value {
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  text-align: right;
  word-break: break-word;
}

/* L1161-1164 */
.pe-confirm-question {
  margin: 8px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

/* ===== Imagen (L880-935): container deepOrange radius 12 ===== */
.pe-image-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--primary);
  border-radius: 12px;
}

.pe-image-preview {
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}

/* errorBuilder (L903-913): grey[800] + icono */
.pe-image-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 200px;
  border-radius: 10px;
  background: var(--bg-surface-2);
  color: var(--text-muted);
}

.pe-image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.pe-image-btn {
  align-self: flex-start;
}

/* Fila de acciones de imagen: 'Cambiar imagen' (CTA del bloque) + 'Quitar
   imagen' (secundaria). Wrap para que en móvil caiga debajo sin desbordar. */
.pe-image-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* 'Quitar imagen': acción destructiva SECUNDARIA. Ghost + texto en el token de
   error al hover: nada de un segundo naranja que compita con Guardar. */
.pe-image-remove {
  align-self: flex-start;
}

.pe-image-remove:hover:not(:disabled) {
  color: var(--error);
  border-color: color-mix(in srgb, var(--error) 45%, transparent);
}

/* ===== Panel alcance del paso 1: radius 12 (L720-756) — distinto del
   radius 10 del panel de la LISTA ===== */
.pe-scope-panel-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #616161;
  border-radius: 12px;
}

.pe-scope-title-editor {
  margin: 0;
  font-weight: 700;
  color: var(--text);
  font-size: 15px;
}

/* ===== Diálogo de items (L278-498) ===== */
.pe-dialog-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}

.pe-dialog-empty {
  margin: 0;
  padding: 16px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

.pe-dialog-cat {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Header categoría (L377-391): chip deepOrange α0.2 bold 13 */
.pe-dialog-cat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pe-dialog-cat-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 110, 64, 0.2);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

/* Botón 'Todos' (L417-452): grey800 + borde grey600, activo deepOrange */
.pe-dialog-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-surface-2);
  border: 1px solid var(--text-3);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.pe-dialog-all--on {
  background: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
}

.pe-dialog-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* FilterChip (L456-494): label 12px, bg grey[850] var(--bg-surface-2), selected
   deepOrangeAccent; borde deepOrange (sel) / grey700 */
.pe-filterchip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 11px;
  border-radius: var(--radius-full);
  background: transparent;
  border: 1px solid var(--border-soft);
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.pe-filterchip:hover {
  border-color: var(--border);
  color: var(--text-1);
}

.pe-filterchip--on {
  background: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
  font-weight: 600;
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

  .pe-step-body {
    padding-left: 24px;
  }

  .pe-group-minmax {
    grid-template-columns: 1fr 1fr;
  }

  .pe-editor-actions {
    flex-direction: column-reverse;
  }

  .pe-editor-actions .pe-btn {
    width: 100%;
  }
}
</style>
