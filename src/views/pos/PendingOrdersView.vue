<script setup lang="ts">
/**
 * PendingOrdersView · pantalla ÓRDENES del rail (Fase 3 ronda 2 + Fase 1-P1).
 *
 * Réplica de pending_orders_screen.dart + widgets/desktop/pending_order_card.dart:
 * - Screen bg grey[900] (#212121), AppBar grey[850] "Órdenes Pendientes" con
 *   botón refresh. El botón Badge de cuentas por cobrar se OMITE (Fase 4).
 * - Barra filtros (bg #303030, padding 12): buscador + icono calendario +
 *   botón fecha + botón "Hoy" + Dropdown de estatus.
 *   4 opciones réplica Flutter (L364-369): Pendientes → 'pendiente',
 *   En curso → 'activas' (Fase 1-P1 backend: IN pre-pago), Entregadas →
 *   'pagado', Todas → sin status (filtra client-side pagadas/canceladas).
 * - PendingOrderCard: bg #303030 radius 12 elev 4 borde 2px (grey #616161
 *   siempre: en Rest no hay EXTERNO/DIDI/UBER aún; _getBorderColor queda listo
 *   con umbral 20 min verde/rojo para cuando exista tipoDeOrden).
 *   Header expandible (chevron + Orden #folio + badge tipo + cajero + fecha +
 *   badge total esquina verde/gris). Timer MM:SS solo si tipo externo existe.
 *   Contenido: items + total verde; botones Agregar/Tickets + Cancelar +
 *   Cobrar.
 * - Fase 1-P1 (édición de pendientes, backend 53604e0): las cards con status
 *   'pendiente' son EDITABLES (réplica pending_order_card.dart) —
 *   qty stepper − /+ por item (− disabled en 1; PATCH quantity; el detalle/
 *   total SIEMPRE de la respuesta del server), botón eliminar (confirm +
 *   DELETE), botón 'Agregar' abre OrderProductPicker (→ POST items; templates
 *   con optionGroups pasan por el MISMO wizard DynamicOptionsModal).
 *   Estados ≠ 'pendiente' quedan read-only (el backend rechazaría con 409).
 *   409 de cualquier edición → toast error + refresh (card pasa a read-only).
 *   editingOrderId deshabilita los steppers de ESA card mientras vuela una
 *   edición (mismo patrón que printingOrderId).
 * - Polling 15s (clearInterval en onBeforeUnmount).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleMinus,
  CirclePlus,
  CircleX,
  DollarSign,
  Pencil,
  Plus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Search,
  Soup,
  Timer,
  Trash2,
} from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import type {
  CatalogTemplate,
  OrderDetail,
  OrderDetailItem,
  OrderItemPayload,
  OrderStatus,
  PaymentMethod,
  PendingOrderListItem,
} from '../../api/pos-types'
import { POS_PLANT_ID, useCatalogStore } from '../../stores/catalog'
import { useCartStore } from '../../stores/cart'
import { useCashStore } from '../../stores/cash'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { AppBanner, AppSelect, AppSpinner } from '../../components/ui'
import AppModal from '../../components/pos/AppModal.vue'
import CancelOrderModal from '../../components/pos/CancelOrderModal.vue'
import DynamicOptionsModal from '../../components/pos/DynamicOptionsModal.vue'
import OrderProductPicker from '../../components/pos/OrderProductPicker.vue'
import { printPendingKitchenTicket, printSaleTickets } from '../../services/ticket'

const ordersStore = useOrdersStore()
const cashStore = useCashStore()
const toast = useToastStore()
const catalogStore = useCatalogStore()
const cartStore = useCartStore()

// --- Filtros (réplica _filterStatus / _selectedDate / _searchController) ------

/** Opciones EXACTAS del Dropdown Flutter (L364-369, orden incluido). */
type StatusFilter = 'Pendiente' | 'En curso' | 'Entregadas' | 'Todas'

/**
 * Mapeo réplica _loadOrders (L104-116): 'Pendiente' → 'pendiente',
 * 'Entregadas' → 'pagado', 'En curso' → 'activas' (backend Fase 1-P1: status
 * IN (pendiente|preparando|listo|entregado)), resto → null (sin filtro).
 * El backend Rest acepta UN string simple (compara exacto o 'activas') —
 * no listas: el tipo cambia de string[] | null a string | null.
 */
const FILTER_STATUS: Record<StatusFilter, string | null> = {
  Pendiente: 'pendiente',
  // Fase 1-P1: 'activas' = pre-pago IN (pendiente, preparando, listo, entregado).
  'En curso': 'activas',
  Entregadas: 'pagado',
  // Todas → null: GET /orders sin status devuelve TODAS (incluye pagadas/
  // canceladas): igual que el Flutter.
  Todas: null,
}

const activeFilter = ref<StatusFilter>('Pendiente')
const searchText = ref('')

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Fecha seleccionada (réplica _selectedDate, default hoy). */
const selectedDate = ref<string>(todayIso())

const selectedDateIsToday = computed(() => selectedDate.value === todayIso())

/** dd/MM/yyyy para el botón fecha (réplica _formatDate L155). */
function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function onDateChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (value !== '') {
    selectedDate.value = value
    void refresh()
  }
}

/**
 * Abre el calendario nativo. El input[type=date] vive oculto (opacity 0) para
 * conservar el label dd/MM/yyyy del diseño, y Chrome NO abre el picker con un
 * click normal sobre un input invisible: solo responde a su indicador interno
 * o a showPicker(). Sin este método el filtro de fecha era inutilizable.
 */
const dateInputRef = ref<HTMLInputElement | null>(null)

function openDatePicker(): void {
  const input = dateInputRef.value
  if (input == null) return
  // showPicker requiere gesto de usuario: aquí venimos del @click del botón.
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
      return
    } catch {
      // Algunos WebViews (Tauri/Android) lo exponen y lo rechazan: fallback.
    }
  }
  input.focus()
  input.click()
}


function onTodayClick(): void {
  selectedDate.value = todayIso()
  void refresh()
}

// --- Carga + polling 15s -------------------------------------------------------

const POLL_MS = 15_000
let pollTimer: ReturnType<typeof setInterval> | null = null

/** Carga la lista con el filtro de estatus activo (null = Todas). */
async function refresh(): Promise<void> {
  await ordersStore.fetchOrdersByStatus(POS_PLANT_ID, selectedDate.value, FILTER_STATUS[activeFilter.value])
}

function switchFilter(filter: StatusFilter): void {
  if (activeFilter.value === filter) return
  activeFilter.value = filter
  expandedId.value = null // el detalle cacheado no aplica al cambiar de filtro
  void refresh()
}

/** v-model del AppSelect de estatus: el setter dispara la recarga. */
const filterModel = computed<StatusFilter>({
  get: () => activeFilter.value,
  set: (value) => switchFilter(value),
})

onMounted(() => {
  void refresh()
  // Gate de caja (ronda cash): asegura current para el cobro de pendientes.
  if (cashStore.current == null) void cashStore.fetchCurrent()
  // Dólares en el cobro: la tasa alimenta la conversión USD→MXN (fallback 0
  // = método bloqueado con banner, réplica legacy).
  if (cashStore.dollarRate == null) void cashStore.fetchDollarRate()
  // El lápiz de "Editar opciones" resuelve el template del item contra el
  // catálogo (mismo criterio que OrderProductPicker). Si el usuario entró
  // directo a Órdenes sin montar el POS, el catálogo está vacío y el botón no
  // aparecería: se carga aquí una sola vez (fetch-once por planta).
  if (!catalogStore.hasCacheForPlant(POS_PLANT_ID)) {
    void catalogStore.fetchCatalog(POS_PLANT_ID)
  }
  pollTimer = setInterval(() => {
    void refresh()
  }, POLL_MS)
  // Reloj del timer (1 s): mantiene avanzando el MM:SS de las externas sin
  // depender del polling de datos.
  clockTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (clockTimer != null) {
    clearInterval(clockTimer)
    clockTimer = null
  }
})

/**
 * Réplica _applyFilters (L133-153): búsqueda por folio, cliente, orderId o
 * número diario + ordenar más reciente primero.
 */
const filteredOrders = computed<PendingOrderListItem[]>(() => {
  const query = searchText.value.trim().toLowerCase()
  const list = ordersStore.pendingOrders.filter((o) => {
    if (query === '') return true
    return (
      o.dailyOrderNumber.toString().includes(query) ||
      o.id.toString().includes(query) ||
      o.waiterName.toLowerCase().includes(query)
    )
  })
  return [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
})

// --- Borde y timer de órdenes externas (_getBorderColor / _needsTimer) --------

const EXTERNAL_TYPES = ['EXTERNO', 'DIDI', 'UBER']
void EXTERNAL_TYPES // documental: tipos con timer cuando exista tipoDeOrden en Rest
const TIMER_GREEN_MINUTES = 20

/**
 * Reloj reactivo: `Date.now()` NO es reactivo, así que si el template lo llama
 * directamente el timer solo se repinta cuando el polling (15 s) trae datos
 * nuevos — y podía quedarse congelado varios segundos o en 00:00.
 *
 * Este ref avanza cada segundo y es la ÚNICA fuente de "ahora" del cálculo.
 * Se detiene en onBeforeUnmount (junto al polling) para no dejar intervalos
 * vivos al salir de la vista.
 */
const nowTick = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

function orderTypeOf(order: PendingOrderListItem): string {
  return (order as unknown as { orderType?: string | null }).orderType ?? 'LOCAL'
}

function isExternal(order: PendingOrderListItem): boolean {
  const tipo = orderTypeOf(order).toUpperCase()
  return (
    tipo.includes('EXTERNO') || tipo.includes('DIDI') || tipo.includes('UBER')
  )
}

function needsTimer(order: PendingOrderListItem): boolean {
  return isExternal(order) && order.orderStatus === 'pendiente'
}

/** Verde si &lt;20 min, rojo si ≥20 (L366-379); gris si no es externa (L367-369). */
function borderColorOf(order: PendingOrderListItem): string {
  if (!needsTimer(order)) return '#616161' // Colors.grey[700]
  const elapsed = nowTick.value - new Date(order.createdAt).getTime()
  return elapsed < TIMER_GREEN_MINUTES * 60_000 ? '#4caf50' : '#f44336'
}

/** MM:SS transcurrido (L382-387). */
function formatElapsedTime(order: PendingOrderListItem): string {
  const created = new Date(order.createdAt).getTime()
  if (Number.isNaN(created)) return '--:--'
  // max(0) protege contra createdAt futuro (desfase de reloj servidor/cliente):
  // sin esto un salto negativo se ve igual que una orden recién creada.
  const elapsed = Math.max(0, nowTick.value - created)
  const totalSeconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// --- Header del card -----------------------------------------------------------

/** dd/MM/yyyy HH:mm (L589). */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function orderTypeBadge(order: PendingOrderListItem): { label: string; className: string } {
  const upper = orderTypeOf(order).toUpperCase()
  if (upper.includes('EXTERNO')) return { label: 'EXTERNO', className: 'externo' }
  if (upper.includes('TRANSFER')) return { label: 'P1 -> P2', className: 'transfer' }
  if (upper.includes('UBER') || upper.includes('DIDI')) {
    return { label: 'UBER/DIDI', className: 'uber-didi' }
  }
  return { label: 'LOCAL', className: 'local' }
}

// ===========================================================================
// Fase 1-P1 · Edición de items (réplica pending_order_card.dart):
// SOLO órdenes 'pendiente'. Toda operación usa la respuesta del server como
// VERDAD (items/total del OrderDetail completo que devuelve el endpoint —
// nunca aritmética local). 409 → toast con message del backend + refresh
// (la card pasa a read-only). editingOrderId bloquea los steppers de ESA
// card mientras vuela una edición (mismo patrón que printingOrderId).
// ===========================================================================

/** true si la card es editable: expandida + status 'pendiente'. */
function isEditable(order: PendingOrderListItem): boolean {
  return order.orderStatus === 'pendiente'
}

/** Id de la orden con una edición en vuelo (steppers de ESA card disabled). */
const editingOrderId = ref<number | null>(null)

/** Id de la fila expandida (detalle visible). */
const expandedId = ref<number | null>(null)

/** Estado local del detalle expandido (items + total del server). */
const expandedDetail = ref<OrderDetail | null>(null)
const expandedItems = ref<OrderDetailItem[] | null>(null)
const expandLoading = ref(false)
const expandError = ref<string | null>(null)

async function toggleExpand(orderId: number): Promise<void> {
  if (expandedId.value === orderId) {
    expandedId.value = null
    expandedItems.value = null
    expandedDetail.value = null
    expandError.value = null
    return
  }
  expandedId.value = orderId
  expandError.value = null
  const cached = ordersStore.detailCache[orderId]
  if (cached != null) {
    expandedDetail.value = cached
    expandedItems.value = cached.items
    return
  }
  expandedItems.value = null
  expandedDetail.value = null
  expandLoading.value = true
  const detail = await ordersStore.fetchOrderDetail(orderId)
  expandLoading.value = false
  if (expandedId.value !== orderId) return // se cambió de fila mientras cargaba
  if (detail == null) {
    expandedItems.value = null
    expandError.value = ordersStore.detailError ?? 'No se pudo cargar el detalle.'
    return
  }
  expandedDetail.value = detail
  expandedItems.value = detail.items
}

/** Total mostrado en la card: el del server tras cada edición (o el de lista). */
function displayTotal(order: PendingOrderListItem): number {
  if (expandedDetail.value != null && expandedId.value === order.id) {
    return expandedDetail.value.total
  }
  return order.total
}

/** Manejo centralizado de errores de edición (400/404/409/red). */
function editErrorToast(err: unknown, action: string): void {
  if (err instanceof ApiError && err.status === 409) {
    // Carrera: la orden dejó de ser 'pendiente' (la cobraron/avanzaron).
    toast.error(err.message !== '' ? err.message : `No se pudo ${action}: la orden ya no está pendiente.`)
    // Invalida el cache y refresca: la card pasará a read-only.
    if (expandedId.value != null) ordersStore.invalidateDetailCache(expandedId.value)
    void refresh()
    return
  }
  if (err instanceof ApiError && err.status !== 0) {
    toast.error(`${err.message}`)
    return
  }
  toast.error(`No se pudo conectar con el servidor. Verifica tu conexión.`)
}

/**
 * Réplica _updateQuantity (L1140): PATCH quantity; el backend responde el
 * detalle completo actualizado → reemplaza items/total. Optimista en el
 * sentido de UI: la card se actualiza al 200 con la respuesta del server.
 */
async function updateQuantity(
  order: PendingOrderListItem,
  item: OrderDetailItem,
  newQuantity: number,
): Promise<void> {
  if (!isEditable(order)) return
  if (newQuantity < 1) return // − en qty 1 está disabled; quitar es DELETE
  if (editingOrderId.value != null) return
  editingOrderId.value = order.id
  try {
    const detail = await ordersStore.updateOrderItemQuantity(order.id, item.id, newQuantity)
    applyDetail(detail)
  } catch (err) {
    editErrorToast(err, 'actualizar la cantidad')
  } finally {
    editingOrderId.value = null
  }
}

/** Reemplaza el estado local del detalle con la respuesta del server. */
function applyDetail(detail: OrderDetail): void {
  expandedDetail.value = detail
  expandedItems.value = detail.items
  // Refleja el nuevo total en la fila de la lista (la fila cambia de total).
  const row = ordersStore.pendingOrders.find((o) => o.id === detail.id)
  if (row != null) {
    row.total = detail.total
    row.orderStatus = detail.orderStatus
  }
}

// --- Eliminar item (réplica _removeItem L1202: AlertDialog confirm) -----------

type ModalState =
  | { kind: 'none' }
  | { kind: 'cancel'; order: PendingOrderListItem }
  | { kind: 'pay'; order: PendingOrderListItem }
  | { kind: 'remove-item'; order: PendingOrderListItem; item: OrderDetailItem }

const modal = ref<ModalState>({ kind: 'none' })

const removingItem = ref(false)

async function confirmRemoveItem(): Promise<void> {
  if (modal.value.kind !== 'remove-item') return
  const { order, item } = modal.value
  if (!isEditable(order)) {
    modal.value = { kind: 'none' }
    return
  }
  removingItem.value = true
  try {
    const detail = await ordersStore.removeOrderItem(order.id, item.id)
    applyDetail(detail)
    toast.success('Producto eliminado de la orden')
    modal.value = { kind: 'none' }
  } catch (err) {
    editErrorToast(err, 'eliminar el producto')
    modal.value = { kind: 'none' }
  } finally {
    removingItem.value = false
  }
}

// --- Agregar producto (réplica _addProductToPendingOrder L249) ----------------

/** Orden a la que se le está agregando un producto (picker abierto). */
const pickerOrderId = ref<number | null>(null)

function openAddProduct(order: PendingOrderListItem): void {
  if (!isEditable(order)) return
  pickerOrderId.value = order.id
}

function closePicker(): void {
  pickerOrderId.value = null
}

const addingItem = ref(false)

/** POST items con el payload armado por el picker (posible tras el wizard). */
async function onPickerAdded(
  payload: import('../../api/pos-types').OrderItemPayload,
  productName: string,
): Promise<void> {
  void productName // el toast usa mensaje fijo (réplica '✅ Producto agregado')
  const orderId = pickerOrderId.value
  if (orderId == null) return
  const order = ordersStore.pendingOrders.find((o) => o.id === orderId)
  if (order == null || !isEditable(order)) {
    closePicker()
    return
  }
  addingItem.value = true
  try {
    const detail = await ordersStore.addOrderItem(orderId, payload)
    applyDetail(detail)
    toast.success('Producto agregado')
    closePicker()
    // Refresca el listado: la fila puede cambiar de total/orden de sort.
    void refresh()
  } catch (err) {
    editErrorToast(err, 'agregar el producto')
    closePicker()
  } finally {
    addingItem.value = false
  }
}

/** Nota legible del item (OPT::/NOTE:: prefijos fuera, separadores → líneas). */
function itemNoteLines(notes: string | null | undefined): string[] {
  if (notes == null || notes === '') return []
  const clean = notes
    .replaceAll('OPT::', '')
    .replaceAll('NOTE::', '')
    .replaceAll('NOTA::', '')
    .trim()
  if (clean === '') return []
  const parts = clean.includes('|')
    ? clean.split('|')
    : clean.includes('\n')
      ? clean.split('\n')
      : [clean]
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/**
 * Líneas de EXTRAS del item desde el dato ESTRUCTURAL `OrderDetailItem.extras`
 * (pos-types.ts L230: [{extraId, name, price}]), NUNCA sintetizadas desde la
 * nota. El original (pending_orders_screen.dart) no tiene campo extras en su
 * modelo (PendingOrderItem L95-131: solo notes) — el backend de ese repo junta
 * los extras DENTRO de la nota y su parser `_buildDetailLines` (L797-909) los
 * pinta como '• nombre' (branches L883/L898: bullet U+2022, bodySmall
 * grey[300]); el precio por extra NO se muestra (el subtotal del renglón ya
 * lo incluye, pending_order_model.dart L128). Réplica: cada extra estructural
 * se añade como una línea bullet más, con el MISMO formato/estilo que las
 * líneas de nota. Tras el fix del backend (deja de generar notas con IDs),
 * este campo estructural es la ÚNICA fuente fiable de extras.
 */
function itemExtraLines(item: OrderDetailItem): Array<{ extraId: number; name: string }> {
  return item.extras ?? []
}

// --- Editar opciones de un item (lápiz) ---------------------------------------
//
// El detalle NO devuelve `selectedOptions` estructurales: las opciones viajan
// como resumen legacy en `notes` (`OPT::Grupo:Valor | ...`). Por eso la edición
// reutiliza el wizard del POS en modo edición: `initialSummary` restaura las
// selecciones desde ese mismo resumen (DynamicOptionsModal.restoreSelections
// FromSummary), y al confirmar el wizard escribe en el CARRITO local. Este
// contenedor intercepta esa línea (baseline de keys), la saca del carrito y la
// aplica a la orden remota: DELETE del item viejo + POST del nuevo con
// selectedOptions. Nunca se inventan opciones: si el template no tiene grupos
// el lápiz no se muestra (ver template del item en el template de la tabla).

/** Item en edición (template resuelto + valores iniciales). */
const editingItem = ref<{
  order: PendingOrderListItem
  item: OrderDetailItem
  template: CatalogTemplate
} | null>(null)

/** Keys del carrito al abrir el wizard (detección del insert al confirmar). */
const editBaselineKeys = ref<Set<string>>(new Set())

/** Template del catálogo para un item (por productId). */
function templateForItem(item: OrderDetailItem): CatalogTemplate | null {
  if (item.productId == null) return null
  const templates = catalogStore.catalog?.templates ?? []
  return templates.find((t) => t.id === item.productId) ?? null
}

/**
 * Resumen de OPCIONES de un renglón (contenido del bloque `OPT::`), que es lo
 * único que entiende el wizard como `initialSummary`. Mezclar la nota libre
 * (NOTE::) rompe el parser por grupos y el wizard arranca sin selección.
 */
function optionsSummaryOf(notes: string | null | undefined): string {
  if (notes == null || notes === '') return ''
  const blocks = notes
    .split('||')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('OPT::'))
  if (blocks.length === 0) return ''
  return blocks
    .map((block) => block.slice('OPT::'.length).trim())
    .filter((block) => block !== '')
    .join(' | ')
}

/** true si el item se puede editar con el wizard (template con grupos). */
function canEditOptions(item: OrderDetailItem): boolean {
  const template = templateForItem(item)
  return template != null && template.optionGroups.length > 0
}

/**
 * Nota LIBRE del usuario de un renglón, sin el bloque de opciones.
 *
 * El POS compone las notas como `OPT::resumen || NOTE::nota` (cart.buildItemNotes)
 * y las versiones viejas podían traer el texto suelto. Al editar opciones las
 * opciones se regeneran completas, así que aquí solo se rescata la nota libre:
 * se descarta el bloque `OPT::` y se limpia el prefijo `NOTE::`.
 */
function userNoteOf(notes: string | null | undefined): string {
  if (notes == null || notes.trim() === '') return ''
  return notes
    .split('||')
    .map((part) => {
      // Un bloque puede arrastrar opciones pegadas ('NOTE::texto | OPT::...'):
      // las opciones se regeneran, así que se corta antes del primer OPT::.
      const optAt = part.indexOf('OPT::')
      const head = optAt >= 0 ? part.slice(0, optAt) : part
      return head
        .replace(/^NOTE::/, '')
        .replace(/^NOTA::/, '')
        .replace(/\|+\s*$/, '') // separadores residuales al cortar
        .trim()
    })
    .filter((part) => part !== '')
    .join(' | ')
}

async function openEditOptions(order: PendingOrderListItem, item: OrderDetailItem): Promise<void> {
  if (!isEditable(order) || editingOrderId.value != null) return
  if (!catalogStore.hasCacheForPlant(POS_PLANT_ID)) {
    await catalogStore.fetchCatalog(POS_PLANT_ID)
  }
  const template = templateForItem(item)
  if (template == null) {
    toast.error('No se encontró el producto en el catálogo.')
    return
  }
  if (template.optionGroups.length === 0) {
    toast.info('Este producto no tiene opciones que editar.')
    return
  }
  editBaselineKeys.value = new Set(cartStore.items.map((it) => it.key))
  editingItem.value = { order, item, template }
}

/**
 * Cierre del wizard de edición: el wizard SIEMPRE escribe en el carrito local
 * (cart.addDynamicItem). Si apareció una línea nueva del template → fue
 * Confirmar: se extrae, se quita del carrito y se aplica a la orden remota.
 * Si no apareció → el usuario canceló y no se toca nada.
 */
async function onEditOptionsClose(): Promise<void> {
  const ctx = editingItem.value
  editingItem.value = null
  if (ctx == null) return

  const inserted = cartStore.items.find(
    (it) =>
      !editBaselineKeys.value.has(it.key) &&
      it.productId === ctx.template.id &&
      it.selectedOptions != null,
  )
  if (inserted == null) return // canceló

  // La línea es de la orden remota, no de la venta en curso.
  cartStore.removeItem(inserted.key)

  const selectedOptions = inserted.selectedOptions ?? []
  const summary = (inserted.dynamicOptionsSummary ?? '').trim()

  // Formato de notas del POS (cart.buildItemNotes): bloques `OPT::` y `NOTE::`
  // unidos por ' || '. Las opciones se REGENERAN desde el wizard (el bloque
  // OPT:: viejo se descarta) y solo se conserva la nota libre del usuario; así
  // no se duplican las opciones al reemplazar el renglón.
  const userNote = userNoteOf(ctx.item.notes)
  const noteParts: string[] = []
  if (userNote !== '') noteParts.push(`NOTE::${userNote}`)
  if (summary !== '') noteParts.push(`OPT::${summary}`)
  const newNotes = noteParts.length > 0 ? noteParts.join(' || ') : undefined

  const payload: OrderItemPayload = {
    productId: ctx.template.id,
    quantity: ctx.item.quantity,
    extras: (ctx.item.extras ?? []).map((e) => ({ extraId: e.extraId })),
    complements: [],
    ...(newNotes != null ? { notes: newNotes } : {}),
    ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
  }

  editingOrderId.value = ctx.order.id
  try {
    // No hay PATCH de opciones: se reemplaza el renglón (DELETE + POST).
    await ordersStore.removeOrderItem(ctx.order.id, ctx.item.id)
    const detail = await ordersStore.addOrderItem(ctx.order.id, payload)
    applyDetail(detail)
    toast.success('Opciones actualizadas')
    void refresh()
  } catch (err) {
    editErrorToast(err, 'actualizar las opciones')
    // El DELETE pudo pasar y el POST fallar: el renglón viejo ya no existe.
    // Se invalida el cache y se recarga del server para no mostrar un estado
    // local ficticio (la expansión re-pide el detalle real).
    ordersStore.invalidateDetailCache(ctx.order.id)
    if (expandedId.value === ctx.order.id) {
      expandedId.value = null
      await toggleExpand(ctx.order.id)
    }
  } finally {
    editingOrderId.value = null
  }
}

/**
 * Impresión real (ronda print): carga el detalle (si no está en cache) e
 * imprime. Cocina = solo ticket kitchen (x2 si keywords); Cliente = cocina
 * + cliente como la venta (estado PENDIENTE DE PAGO).
 */
const printingOrderId = ref<number | null>(null)

async function printOrderTickets(
  order: PendingOrderListItem,
  kind: 'kitchen' | 'client',
): Promise<void> {
  if (printingOrderId.value != null) return
  printingOrderId.value = order.id
  try {
    const detail = await ordersStore.fetchOrderDetail(order.id)
    if (detail == null) {
      toast.error('No se pudo cargar el detalle de la orden.')
      return
    }
    // OrderDetailItem → KitchenTicketItem/ClientTicketItem. El detalle trae
    // extras; complementos no viajan en el detalle (backend no los retorna).
    const items = detail.items.map((it) => ({
      key: `d-${it.id}`,
      productId: it.productId ?? null,
      productName: it.productName,
      quantity: it.quantity,
      priceAtTimeOfAddition: it.unitPrice,
      extras: (it.extras ?? []).map((e) => ({ id: e.extraId, name: e.name, price: e.price })),
      complement: null,
      note: '',
      dynamicOptionsSummary: null,
      selectedOptions: null,
    }))
    const shared = {
      folio: String(detail.dailyOrderNumber),
      orderType: detail.orderType,
      platformDeliveryInfo: null,
      items,
      total: detail.total,
      orderId: detail.id,
    }
    const ok =
      kind === 'kitchen'
        ? printPendingKitchenTicket(shared)
        : printSaleTickets({
            ...shared,
            paidState:
              detail.orderStatus === 'pagado'
                ? { paymentMethod: 'efectivo', amountReceived: detail.total, changeAmount: 0 }
                : null,
          })
    if (ok) toast.success(kind === 'kitchen' ? '🖨️ Ticket de cocina enviado' : '🖨️ Tickets enviados')
    else toast.error('No se pudo abrir el diálogo de impresión.')
  } finally {
    printingOrderId.value = null
  }
}

// --- Cancelar (funcional: rol cajero/admin + nota) ------------------------------
// ModalState vive arriba (sección de edición: cancel/pay/remove-item).

// --- Cobro (réplica _showAmountReceivedDialog de order_panel.dart L167-320 +
//     flujo 2 pasos de pending_order_card.dart: Pago Simple / Pago Múltiple) ----

const payMethod = ref<PaymentMethod>('efectivo')
const payAmountText = ref('')
const paySubmitting = ref(false)
const payError = ref<string | null>(null)

/**
 * Mixto (method=ambos, réplica MultiplePaymentDialog): parte efectivo +
 * parte tarjeta. payMixCash/payMixCard son MXN capturados en el numpad.
 * amountReceived enviado = efectivo recibido; el backend calcula
 * changeAmount = amountReceived - total (mixCash >= total - mixCard).
 */
const payMixCashText = ref('')
const payMixCardText = ref('')

/**
 * Paso 1 del flujo legacy (pending_order_card.dart L1388-1421): elegir
 * 'Pago Simple' (un método) o 'Mixto' (efectivo+tarjeta, method=ambos).
 */
const payStep = ref<'method' | 'capture'>('method')

function chooseKind(kind: 'simple' | 'mixto'): void {
  payMethod.value = kind === 'mixto' ? 'ambos' : 'efectivo'
  payAmountText.value = ''
  payError.value = null
  payStep.value = 'capture'
}

function openPay(order: PendingOrderListItem): void {
  modal.value = { kind: 'pay', order }
  payMethod.value = 'efectivo'
  payAmountText.value = ''
  payMixCashText.value = ''
  payMixCardText.value = ''
  payError.value = null
  payStep.value = 'method'
}

/** Tasa dólar activa (0 = no configurada → método bloqueado). */
const rate = computed(() => cashStore.rate)

/** Suma capturada en el mixto (efectivo + tarjeta). */
const mixSum = computed(() => parseAmount(payMixCashText.value) + parseAmount(payMixCardText.value))

function pressPayKey(key: string): void {
  if (key === 'C') {
    payAmountText.value = ''
    return
  }
  if (key === '←') {
    payAmountText.value = payAmountText.value.slice(0, -1)
    return
  }
  if (key === '.' && payAmountText.value.includes('.')) return
  const digits = payAmountText.value.replaceAll('.', '')
  if (key !== '.' && digits.length >= 8) return
  payAmountText.value += key
}

const payAmount = computed<number | null>(() => {
  const trimmed = payAmountText.value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
})

const payChange = computed<number>(() => {
  if (modal.value.kind !== 'pay') return 0
  if (payMethod.value === 'tarjeta' || payMethod.value === 'transferencia') return 0
  if (payMethod.value === 'ambos') {
    const cash = parseAmount(payMixCashText.value)
    const card = parseAmount(payMixCardText.value)
    return Math.max(0, cash + card - modal.value.order.total)
  }
  return Math.max(0, (payAmount.value ?? 0) - modal.value.order.total)
})

function parseAmount(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const payMixParts = computed<{ cash: number; card: number } | null>(() => {
  if (modal.value.kind !== 'pay') return null
  const cash = parseAmount(payMixCashText.value)
  const card = parseAmount(payMixCardText.value)
  if (cash <= 0 || card <= 0) return null
  return { cash, card }
})

const payMixProblem = computed<string | null>(() => {
  if (modal.value.kind !== 'pay' || payMethod.value !== 'ambos') return null
  const parts = payMixParts.value
  if (parts == null) return 'Captura el monto de EFECTIVO y de TARJETA.'
  const sum = parts.cash + parts.card
  if (Math.abs(sum - modal.value.order.total) > 0.001) {
    return `La suma $${sum.toFixed(2)} debe ser igual al total $${modal.value.order.total.toFixed(2)}.`
  }
  return null
})

const payProblem = computed<string | null>(() => {
  if (modal.value.kind !== 'pay') return null
  if (payMethod.value === 'ambos') return payMixProblem.value
  if (payMethod.value === 'tarjeta' || payMethod.value === 'transferencia') return null
  if (payMethod.value === 'dolares') {
    if (payAmount.value == null) return 'Captura el monto en dólares recibido.'
    if (payAmount.value <= 0) return 'El monto debe ser mayor a 0.'
    if (rate.value <= 0) return null // banner de tasa lo cubre
    const mxn = payAmount.value * rate.value
    if (mxn < modal.value.order.total) {
      return `Con tasa $${rate.value.toFixed(2)}: $${payAmount.value.toFixed(2)} USD = $${mxn.toFixed(2)} MXN, menor al total.`
    }
    return null
  }
  if (payAmount.value == null) return 'Captura el monto con el que paga el cliente.'
  if (payAmount.value <= 0) return 'El monto debe ser mayor a 0.'
  if (payAmount.value < modal.value.order.total) {
    return `El monto debe ser ≥ $${modal.value.order.total.toFixed(2)}.`
  }
  return null
})

async function confirmPay(): Promise<void> {
  if (modal.value.kind !== 'pay') return
  if (payProblem.value != null) {
    payError.value = payProblem.value
    return
  }
  const order = modal.value.order
  // Gate de caja (ronda cash · réplica del StateError de
  // pending_payments_screen.dart L616-617): sin sesión abierta NO se cobra.
  if (!cashStore.hasOpenSession) {
    payError.value = 'No hay una sesión de caja abierta para el Piso 1.'
    return
  }
  paySubmitting.value = true
  payError.value = null
  try {
    let method: PaymentMethod = payMethod.value
    let amount: number
    let amountReceivedUsd: number | undefined
    if (payMethod.value === 'ambos') {
      const parts = payMixParts.value
      if (parts == null) {
        payError.value = payMixProblem.value
        return
      }
      // method=ambos: amountReceived = EFECTIVO recibido; el backend calcula
      // changeAmount = amountReceived - total (la tarjeta cubre el resto).
      amount = parts.cash + parts.card
    } else if (payMethod.value === 'tarjeta' || payMethod.value === 'transferencia') {
      amount = order.total
    } else if (payMethod.value === 'dolares') {
      amount = (payAmount.value ?? 0) * rate.value
      amountReceivedUsd = payAmount.value ?? 0
    } else {
      amount = payAmount.value ?? order.total
    }
    const result = await ordersStore.payExistingOrder(order.id, {
      method,
      amountReceived: amount,
      ...(amountReceivedUsd != null ? { amountReceivedUsd } : {}),
      expectedStatus: order.orderStatus as OrderStatus,
      // Atribuye el cobro a la sesión de caja abierta (ronda cash).
      ...(cashStore.hasOpenSession ? { cashSessionId: cashStore.sessionId } : {}),
    })
    if (result != null) {
      const methodLabel =
        method === 'ambos'
          ? `Mixto (efectivo $${(payMixParts.value?.cash ?? 0).toFixed(2)} + tarjeta $${(payMixParts.value?.card ?? 0).toFixed(2)})`
          : method
      toast.success(
        `Orden #${order.dailyOrderNumber} cobrada (${methodLabel}) — cambio: $${result.changeAmount.toFixed(2)}`,
      )
      modal.value = { kind: 'none' }
      await refresh()
    } else {
      const conflict = ordersStore.lastConflict
      payError.value =
        conflict != null && conflict.currentStatus !== 'not-found'
          ? `La orden ya está "${conflict.currentStatus}" (alguien la cobró o avanzó antes). Recargando…`
          : 'La orden cambió de estado. Recargando…'
      if (conflict != null && conflict.currentStatus !== 'not-found') await refresh()
    }
  } catch (err) {
    payError.value =
      err instanceof ApiError && err.status !== 0
        ? `Error al cobrar: ${err.message}`
        : 'No se pudo conectar con el servidor.'
  } finally {
    paySubmitting.value = false
  }
}

// --- Formato ----------------------------------------------------------------

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '←'] as const
</script>

<template>
  <div class="po">
    <!-- ================= APPBAR (grey[850]) ================= -->
    <header class="po-appbar" data-testid="orders-appbar">
      <h1 class="po-appbar-title">Órdenes Pendientes</h1>
      <button
        type="button"
        class="po-icon-btn"
        data-testid="orders-refresh"
        aria-label="Recargar órdenes"
        title="Recargar"
        @click="refresh"
      >
        <RefreshCw :size="20" aria-hidden="true" />
      </button>
    </header>

    <!-- ============ BARRA FILTROS (bg #303030, padding 12) ============ -->
    <div class="po-filters">
      <!-- Buscador -->
      <div class="po-search">
        <Search :size="18" class="po-search-icon" aria-hidden="true" />
        <input
          v-model="searchText"
          type="text"
          class="po-search-input"
          placeholder="Buscar órdenes..."
          aria-label="Buscar órdenes"
          data-testid="orders-search"
        />
      </div>

      <!-- Fila: calendario + fecha + Hoy + dropdown estatus -->
      <div class="po-filter-row">
        <Calendar :size="18" class="po-calendar-icon" aria-hidden="true" />
        <div class="po-date-btn">
          <!-- Trigger real: el input[type=date] está oculto (opacity 0) para
               conservar el label dd/MM/yyyy del diseño. Chrome solo abre el
               calendario al pulsar su indicador interno, invisible en este
               caso, así que el picker se abre por showPicker() desde el click
               del botón (gesto de usuario válido). -->
          <button
            type="button"
            class="po-date-trigger"
            data-testid="orders-date-open"
            aria-label="Seleccionar fecha"
            @click="openDatePicker"
          >
            <span class="po-date-label">{{ formatDateLabel(selectedDate) }}</span>
          </button>
          <input
            ref="dateInputRef"
            type="date"
            class="po-date-input"
            :value="selectedDate"
            tabindex="-1"
            aria-hidden="true"
            data-testid="orders-date"
            @change="onDateChange"
          />
        </div>
        <button
          type="button"
          class="po-today-btn"
          :class="{ 'po-today-btn--active': selectedDateIsToday }"
          data-testid="orders-today"
          aria-label="Ir a hoy"
          title="Hoy"
          @click="onTodayClick"
        >
          <Receipt :size="18" aria-hidden="true" />
        </button>
        <!-- Filtro estatus: AppSelect propio (picker nativo de iOS PWA no
             confirma la opción tocada); setter dispara la recarga.
             4 opciones réplica Flutter L364-369 (orden exacto). -->
        <AppSelect
          v-model="filterModel"
          :options="[
            { value: 'Pendiente', label: 'Pendientes' },
            { value: 'En curso', label: 'En curso' },
            { value: 'Entregadas', label: 'Entregadas' },
            { value: 'Todas', label: 'Todas' },
          ]"
          testid="orders-status"
          aria-label="Filtrar por estatus"
        />
      </div>
    </div>

    <!-- ================= LISTA DE ÓRDENES ================= -->
    <div class="po-body">
      <div v-if="ordersStore.loading && ordersStore.pendingOrders.length === 0" class="po-state">
        <AppSpinner :size="32" tone="primary" />
      </div>

      <div v-else-if="ordersStore.error" class="po-state">
        <CircleAlert :size="64" class="po-state-error-icon" aria-hidden="true" />
        <p class="po-state-text">{{ ordersStore.error }}</p>
        <button type="button" class="po-retry" @click="refresh">Reintentar</button>
      </div>

      <div v-else-if="filteredOrders.length === 0" class="po-state">
        <ReceiptText :size="64" class="po-state-empty-icon" aria-hidden="true" />
        <p class="po-state-empty">No hay órdenes</p>
      </div>

      <ul v-else class="po-list" data-testid="pending-list">
        <li
          v-for="order in filteredOrders"
          :key="order.id"
          class="po-card"
          :style="{ borderColor: borderColorOf(order) }"
          :data-testid="`order-card-${order.id}`"
        >
          <!-- ===== HEADER (bg grey[800], expandible) ===== -->
          <button
            type="button"
            class="po-card-header"
            :aria-expanded="expandedId === order.id"
            :aria-label="`Detalle de orden #${order.dailyOrderNumber}`"
            @click="toggleExpand(order.id)"
          >
            <component
              :is="expandedId === order.id ? ChevronUp : ChevronDown"
              :size="24"
              class="po-chevron"
              aria-hidden="true"
            />
            <span class="po-card-head-info">
              <span class="po-card-head-row">
                <span class="po-folio">Orden #{{ order.dailyOrderNumber }}</span>
                <span :class="['po-type-badge', `po-type-badge--${orderTypeBadge(order).className}`]">
                  {{ orderTypeBadge(order).label }}
                </span>
              </span>
              <span v-if="order.waiterName" class="po-customer">{{ order.waiterName }}</span>
              <!-- Timer EXTERNO/DIDI/UBER pendiente (MM:SS) -->
              <span v-if="needsTimer(order)" class="po-timer" :style="{ color: borderColorOf(order) }">
                <Timer :size="14" aria-hidden="true" />
                {{ formatElapsedTime(order) }}
              </span>
              <span class="po-created">{{ formatDateTime(order.createdAt) }}</span>
            </span>
            <!-- Badge del total en la esquina (verde si pendiente, gris si no).
                 Muestra el total del server tras cada edición. -->
            <span
              class="po-total-badge"
              :class="{ 'po-total-badge--pending': order.orderStatus === 'pendiente' }"
              :data-testid="`order-total-${order.id}`"
            >
              <DollarSign :size="18" aria-hidden="true" />
              {{ displayTotal(order).toFixed(2) }}
            </span>
          </button>

          <!-- ===== CONTENIDO EXPANDIBLE ===== -->
          <div v-if="expandedId === order.id" class="po-card-content" aria-live="polite">
            <p class="po-content-title">Productos:</p>

            <div v-if="expandLoading" class="po-expand-state">
              <AppSpinner :size="18" tone="primary" />
              <span>Cargando detalle…</span>
            </div>
            <AppBanner v-else-if="expandError != null" type="error">{{ expandError }}</AppBanner>
            <p v-else-if="expandedItems == null || expandedItems.length === 0" class="po-no-items">
              Sin items
            </p>
            <ul v-else class="po-items">
              <li v-for="item in expandedItems" :key="item.id" class="po-item">
                <!-- Columna qty: remove rojo / cantidad / add teal.
                     Editable SOLO si la orden está 'pendiente' (réplica
                     !widget.readOnly && status == pending del .dart L769):
                     − disabled en qty 1 (quitar = botón eliminar), + aumenta.
                     Deshabilitados mientras vuela una edición de ESA card. -->
                <span v-if="isEditable(order)" class="po-item-qty-col">
                  <button
                    type="button"
                    class="po-item-qty-btn po-item-qty-btn--remove"
                    :aria-label="`Reducir ${item.productName}`"
                    :data-testid="`item-minus-${item.id}`"
                    :disabled="item.quantity <= 1 || editingOrderId === order.id"
                    @click="updateQuantity(order, item, item.quantity - 1)"
                  >
                    <CircleMinus :size="22" aria-hidden="true" />
                  </button>
                  <span class="po-item-qty">{{ item.quantity }}</span>
                  <button
                    type="button"
                    class="po-item-qty-btn po-item-qty-btn--add"
                    :aria-label="`Aumentar ${item.productName}`"
                    :data-testid="`item-plus-${item.id}`"
                    :disabled="editingOrderId === order.id"
                    @click="updateQuantity(order, item, item.quantity + 1)"
                  >
                    <CirclePlus :size="22" aria-hidden="true" />
                  </button>
                </span>
                <!-- Read-only (preparando/listo/entregado/pagado/cancelada):
                     solo la cantidad, como hoy. -->
                <span v-else class="po-item-qty-col po-item-qty-col--readonly">
                  <span class="po-item-qty">{{ item.quantity }}×</span>
                </span>

                <span class="po-item-info">
                  <span class="po-item-name">
                    {{ item.productName }}
                    <!-- Sub-líneas del item (réplica _buildDetailLines L797-909
                         del .dart): notas parseadas + EXTRAS estructurales,
                         todos como bullets del mismo estilo (.po-item-note).
                         Las extras SOLO salen de item.extras (campo
                         estructural del detalle) — nunca se sintetizan desde
                         la nota, así el 'GRUPO=ID' que el backend dejaba en
                         las notas nunca se duplica ni se re-sintetiza. -->
                    <span
                      v-if="itemNoteLines(item.notes).length > 0 || itemExtraLines(item).length > 0"
                      class="po-item-notes"
                    >
                      <span v-for="line in itemNoteLines(item.notes)" :key="`n-${line}`" class="po-item-note">
                        • {{ line }}
                      </span>
                      <span
                        v-for="extra in itemExtraLines(item)"
                        :key="`x-${extra.extraId}`"
                        class="po-item-note"
                      >
                        • {{ extra.name }}
                      </span>
                    </span>
                  </span>
                </span>

                <span v-if="isEditable(order)" class="po-item-actions">
                  <button
                    v-if="canEditOptions(item)"
                    type="button"
                    class="po-item-edit"
                    :aria-label="`Editar opciones de ${item.productName}`"
                    :data-testid="`item-edit-${item.id}`"
                    :disabled="editingOrderId === order.id"
                    @click="openEditOptions(order, item)"
                  >
                    <Pencil :size="20" aria-hidden="true" />
                  </button>
                  <!-- Eliminar (réplica delete_outline rojo L887-891): confirm
                       antes del DELETE (réplica AlertDialog L1203-1207). -->
                  <button
                    type="button"
                    class="po-item-delete"
                    :aria-label="`Eliminar ${item.productName}`"
                    :data-testid="`item-delete-${item.id}`"
                    :disabled="editingOrderId === order.id"
                    @click="modal = { kind: 'remove-item', order, item }"
                  >
                    <Trash2 :size="20" aria-hidden="true" />
                  </button>
                </span>
              </li>
            </ul>

            <div class="po-divider" aria-hidden="true"></div>

            <!-- Botones (Wrap spaceBetween) -->
            <div class="po-actions">
              <span class="po-actions-left">
                <button
                  v-if="order.orderStatus === 'pendiente'"
                  type="button"
                  class="po-btn po-btn--add"
                  :data-testid="`order-add-${order.id}`"
                  :disabled="editingOrderId === order.id || addingItem"
                  @click="openAddProduct(order)"
                >
                  <Plus :size="18" aria-hidden="true" />
                  Agregar
                </button>
                <button
                  type="button"
                  class="po-btn po-btn--ticket-client"
                  :data-testid="`order-ticket-client-${order.id}`"
                  :disabled="printingOrderId === order.id"
                  @click="printOrderTickets(order, 'client')"
                >
                  <ReceiptText :size="18" aria-hidden="true" />
                  Ticket Cliente
                </button>
                <button
                  type="button"
                  class="po-btn po-btn--ticket-kitchen"
                  :data-testid="`order-ticket-kitchen-${order.id}`"
                  :disabled="printingOrderId === order.id"
                  @click="printOrderTickets(order, 'kitchen')"
                >
                  <Soup :size="18" aria-hidden="true" />
                  Ticket Cocina
                </button>
              </span>
              <span v-if="order.orderStatus === 'pendiente'" class="po-actions-right">
                <span class="po-total" :data-testid="`order-sum-${order.id}`">
                  {{ formatMoney(displayTotal(order)) }}
                </span>
                <button
                  type="button"
                  class="po-btn po-btn--cancel"
                  :data-testid="`order-cancel-${order.id}`"
                  @click="modal = { kind: 'cancel', order }"
                >
                  <CircleX :size="18" class="po-cancel-icon" aria-hidden="true" />
                  Cancelar Orden
                </button>
                <button
                  type="button"
                  class="po-btn po-btn--pay"
                  :data-testid="`order-pay-${order.id}`"
                  @click="openPay(order)"
                >
                  <DollarSign :size="18" aria-hidden="true" />
                  Cobrar
                </button>
              </span>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- Modal de cancelación (funcional: nota obligatoria + 403) -->
    <CancelOrderModal
      v-if="modal.kind === 'cancel'"
      :order="modal.order"
      @close="modal = { kind: 'none' }"
      @cancelled="refresh"
    />

    <!-- Confirm de eliminar item (réplica AlertDialog L1203-1207) -->
    <AppModal
      v-if="modal.kind === 'remove-item'"
      title="Eliminar Producto"
      :width="420"
      :dismissible="!removingItem"
      @close="modal = { kind: 'none' }"
    >
      <p class="po-remove-text" data-testid="remove-item-text">
        ¿Eliminar {{ modal.item.productName }} (x{{ modal.item.quantity }}) de la orden?
      </p>
      <template #footer>
        <button
          type="button"
          class="pay-btn pay-btn--ghost"
          :disabled="removingItem"
          @click="modal = { kind: 'none' }"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pay-btn pay-btn--danger"
          :disabled="removingItem"
          data-testid="confirm-remove-item"
          @click="confirmRemoveItem"
        >
          {{ removingItem ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </AppModal>

    <!-- Picker de productos (Fase 1-P1: réplica _ProductPickerDialog + wizard) -->
    <OrderProductPicker
      v-if="pickerOrderId != null"
      @close="closePicker"
      @added="onPickerAdded"
    />

    <!-- Wizard de opciones en modo EDICIÓN (lápiz del item): restaura las
         opciones desde el resumen legacy `OPT::` de las notas y, al confirmar,
         reemplaza el renglón de la orden (DELETE + POST con selectedOptions). -->
    <DynamicOptionsModal
      v-if="editingItem != null"
      :template="editingItem.template"
      :initial-summary="optionsSummaryOf(editingItem.item.notes)"
      :initial-note="''"
      @close="onEditOptionsClose"
    />

    <!-- Modal de pago (flujo legacy 2 pasos: Pago Simple / Mixto, luego método
         + monto — réplica pending_order_card.dart L1388-1523) -->
    <div
      v-if="modal.kind === 'pay'"
      class="pay-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="payStep === 'method' ? 'Tipo de pago' : 'Monto Recibido'"
    >
      <div class="pay-card" data-testid="pay-modal">
        <!-- PASO 1 (legacy): tipo de pago -->
        <template v-if="payStep === 'method'">
          <h2 class="pay-title">Tipo de Pago</h2>
          <div class="pay-body">
            <p class="pay-total-line">
              Total a pagar: <strong>{{ formatMoney(modal.order.total) }}</strong>
            </p>
            <div class="pay-kind">
              <button
                type="button"
                class="pay-kind-btn"
                data-testid="pay-kind-simple"
                @click="chooseKind('simple')"
              >
                <span class="pay-kind-icon" aria-hidden="true">💵</span>
                <span class="pay-kind-title">Pago Simple</span>
                <span class="pay-kind-sub">Un solo método de pago</span>
              </button>
              <button
                type="button"
                class="pay-kind-btn"
                data-testid="pay-kind-mixto"
                @click="chooseKind('mixto')"
              >
                <span class="pay-kind-icon" aria-hidden="true">💳</span>
                <span class="pay-kind-title">Mixto</span>
                <span class="pay-kind-sub">Combinar efectivo y tarjeta</span>
              </button>
            </div>
          </div>
        </template>

        <!-- PASO 2 (legacy): método + monto -->
        <template v-else>
          <h2 class="pay-title">
            <button type="button" class="pay-back" aria-label="Volver" @click="payStep = 'method'">←</button>
            {{ payMethod === 'ambos' ? 'Mixto: Efectivo + Tarjeta' : 'Monto Recibido' }}
          </h2>
          <div class="pay-body">
            <p class="pay-total-line">
              Total a pagar: <strong>{{ formatMoney(modal.order.total) }}</strong>
            </p>

            <div v-if="payMethod !== 'ambos'" class="pay__methods" role="radiogroup" aria-label="Método de pago">
              <button
                v-for="m in (['efectivo', 'tarjeta', 'transferencia', 'dolares'] as const)"
                :key="m"
                type="button"
                class="pay__method"
                :class="{ 'pay__method--selected': payMethod === m }"
                role="radio"
                :aria-checked="payMethod === m"
                :disabled="m === 'dolares' && rate <= 0"
                @click="payMethod = m"
              >
                {{
                  m === 'dolares' && rate > 0
                    ? `Dólares ($${rate.toFixed(2)} MXN)`
                    : m === 'transferencia'
                      ? 'Transferencia'
                      : m.charAt(0).toUpperCase() + m.slice(1)
                }}
              </button>
            </div>
            <AppBanner v-if="payMethod === 'dolares' && rate <= 0" type="warning">
              ⚠️ Precio del dólar no configurado
            </AppBanner>

            <template v-if="payMethod === 'ambos'">
              <!-- Mixto: 2 capturas (réplica MultiplePaymentDialog simplificada
                   a la pareja efectivo+tarjeta que manda el catálogo 'ambos') -->
              <div class="pay-mix">
                <div class="pay-mix-row">
                  <span class="pay-mix-label">💵 Efectivo</span>
                  <input
                    v-model="payMixCashText"
                    class="pay-mix-input"
                    type="text"
                    inputmode="decimal"
                    data-testid="pay-mix-cash"
                    aria-label="Monto en efectivo"
                    placeholder="$0.00"
                  />
                </div>
                <div class="pay-mix-row">
                  <span class="pay-mix-label">💳 Tarjeta</span>
                  <input
                    v-model="payMixCardText"
                    class="pay-mix-input"
                    type="text"
                    inputmode="decimal"
                    data-testid="pay-mix-card"
                    aria-label="Monto con tarjeta"
                    placeholder="$0.00"
                  />
                </div>
                <div class="pay-change pay-change--mix" aria-live="polite">
                  <span>{{ mixSum > modal.order.total ? 'Sobra:' : 'Falta:' }}</span>
                  <span>{{ formatMoney(Math.abs(mixSum - modal.order.total)) }}</span>
                </div>
              </div>
            </template>

            <template v-else-if="payMethod !== 'tarjeta' && payMethod !== 'transferencia'">
              <div class="pay-amount" data-testid="pay-amount-display">
                {{ payAmountText === '' ? '$0.00' : `$${payAmountText}` }}{{ payMethod === 'dolares' ? ' USD' : '' }}
              </div>
              <div v-if="payMethod === 'dolares'" class="pay-usd-note">
                Total: ${{ modal.order.total.toFixed(2) }} MXN ≈ ${{ rate > 0 ? (modal.order.total / rate).toFixed(2) : '—' }} USD
              </div>
              <div class="pay-numpad">
                <button
                  v-for="key in numpadKeys"
                  :key="key"
                  type="button"
                  class="pay-key"
                  @click="pressPayKey(key)"
                >
                  {{ key }}
                </button>
                <button type="button" class="pay-key pay-key--clear" @click="pressPayKey('C')">C</button>
                <button
                  type="button"
                  class="pay-key pay-key--exact"
                  @click="payAmountText = modal.kind === 'pay' ? (payMethod === 'dolares' && rate > 0 ? (modal.order.total / rate).toFixed(2) : modal.order.total.toFixed(2)) : ''"
                >
                  Exacto
                </button>
              </div>
              <div
                v-if="modal.kind === 'pay'"
                class="pay-change"
                :class="{ 'pay-change--missing': (payAmount ?? 0) < modal.order.total && payMethod === 'efectivo' }"
                data-testid="pay-change"
                aria-live="polite"
              >
                <span>{{ (payAmount ?? 0) < modal.order.total ? 'Falta:' : 'Cambio:' }}</span>
                <span>{{ formatMoney(Math.abs(payChange)) }}{{ payMethod === 'dolares' ? ' MXN' : '' }}</span>
              </div>
            </template>

            <p v-else-if="payMethod === 'transferencia'" class="pay-note">\              Pago con QR o transferencia: se registra el total.</p>
            <p v-else class="pay-note">Pago con tarjeta: se registra el total.</p>

            <AppBanner v-if="payError" type="error">{{ payError }}</AppBanner>
          </div>
          <div class="pay-footer">
            <button
              type="button"
              class="pay-btn pay-btn--ghost"
              :disabled="paySubmitting"
              @click="modal = { kind: 'none' }"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="pay-btn pay-btn--confirm"
              :disabled="paySubmitting || payProblem != null"
              data-testid="confirm-pay"
              @click="confirmPay"
            >
              {{ paySubmitting ? 'Procesando…' : 'Confirmar Pago' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   SCREEN (pending_orders_screen.dart): bg grey[900], columna
   ========================================================================== */
.po {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
  background: var(--bg); /* grey[900] var(--bg) */
}

/* AppBar (grey[850] var(--bg-surface-2), title 20 bold, refresh a la derecha) */
.po-appbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-surface); /* grey[850] */
}

.po-appbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.po-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Objetivo táctil 44px (icono 20px dentro). */
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.po-icon-btn:hover {
  background: var(--card-overlay);
}

/* ============ BARRA FILTROS (container bg var(--bg-surface-2), padding 12) ============ */
.po-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-surface);
}

/* Buscador: fill var(--bg), radius 8, borde #616161, icono búsqueda 18 gris */
.po-search {
  position: relative;
}

.po-search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

.po-search-input {
  width: 100%;
  height: 40px;
  padding: 0 10px 0 34px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 14px;
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.po-search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
}

.po-search-input::placeholder {
  color: var(--text-3); /* grey[500] */
}

.po-search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
}

.po-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.po-calendar-icon {
  color: var(--text);
  flex: none;
}

/* Botón fecha (ElevatedButton.icon grey[800]) — trigger real + input date oculto */
.po-date-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: var(--bg-surface-2); /* grey[800] */
  border-radius: 8px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
}

/* Trigger clicable: el usuario toca la fecha, no un input invisible.
   min-height 44 = objetivo táctil del POS (guía del rediseño). */
.po-date-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.po-date-trigger:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

/* El input solo existe como ancla del picker nativo (showPicker). Mantiene el
   data-testid del contrato y el evento @change; nunca recibe clics directos. */
.po-date-input {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.po-today-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-faint); /* gris si no es hoy */
  cursor: pointer;
  transition: color 0.15s ease;
}

.po-today-btn--active {
  color: var(--text); /* blanco si es hoy (L302-304) */
}

/* ================= LISTA (ListView padding 16) ================= */
.po-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.po-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.po-state-error-icon {
  color: #ef9a9a; /* Colors.red[300] */
}

.po-state-empty-icon {
  color: var(--text-3); /* grey[500] */
}

.po-state-text {
  margin: 0;
  color: var(--text);
}

.po-state-empty {
  margin: 0;
  color: var(--text-2); /* grey[400] */
  font-size: 16px;
}

.po-retry {
  padding: 10px 24px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.po-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ===== PendingOrderCard: bg grey[850], radius 12, elev 4, borde 2px ===== */
.po-card {
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color var(--dur) var(--ease);
}

.po-card--expanded {
  border-color: var(--border);
}

/* Header (bg grey[800] var(--bg-surface-2), borde inferior grey[700]) */
.po-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition: background var(--dur) var(--ease);
}

@media (hover: hover) {
  .po-card-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }
}

.po-chevron {
  color: var(--text);
  flex: none;
  margin-top: 2px;
}

.po-card-head-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.po-card-head-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.po-folio {
  color: var(--text-1);
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Badge tipo (L2271-2326): local gris / externo azul / uber-didi naranja /
   transfer púrpura */
/* Badge de tipo: neutro; el color solo aparece en el indicador puntual */
.po-type-badge {
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid var(--border-soft);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--text-2);
}

.po-type-badge--local {
  border-color: var(--border-soft);
}

.po-type-badge--externo {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 35%, transparent);
}

.po-type-badge--uber-didi {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
}

.po-type-badge--transfer {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
}

.po-customer {
  color: var(--text-2);
  font-size: 13px;
}

/* Timer chip externo: pill con el color del estado */
.po-timer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.po-created {
  color: var(--text-3); /* grey[500] */
  font-size: 12px;
}

/* Badge del total en la esquina (L608-643): pill verde si pendiente, gris si no */
.po-total-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-1);
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.po-total-badge--pending {
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  background: var(--primary-soft);
  color: var(--primary);
}

/* ===== Contenido expandible (padding 16) ===== */
.po-card-content {
  padding: 16px;
  background: var(--bg-surface);
}

.po-content-title {
  margin: 0 0 12px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.po-expand-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.po-no-items {
  margin: 0;
  text-align: center;
  color: var(--text-3);
}

.po-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Item (L748-887): box grey[800] radius 8 borde grey[700], qty column izq */
.po-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}

/* Acciones del item (pencil + trash): fila derecha */
.po-item-actions {
  display: flex;
  align-items: center;
  flex: none;
}

.po-item-qty-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: none;
}

.po-item-qty-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Objetivo táctil 44px: el icono se queda en 22px dentro del área. */
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.po-item-qty-btn--remove {
  color: var(--text-2);
}

.po-item-qty-btn--remove:hover {
  color: var(--error);
}

.po-item-qty-btn--add {
  color: var(--text-2);
}

.po-item-qty-btn--add:hover {
  color: var(--primary);
}

.po-item-qty {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.po-item-info {
  flex: 1;
  min-width: 0;
}

.po-item-name {
  display: block;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

/* Sub-líneas del item (L890-940 del .dart): notas + extras estructurales,
   gris 12 itálica con bullet — MISMO estilo para ambas fuentes (el original
   pinta extras de nota y cualquier otra línea con el mismo bullet). */
.po-item-notes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.po-item-note {
  color: var(--text-2); /* grey[400] */
  font-size: 12px;
  font-style: italic;
}

.po-item-edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Objetivo táctil 44px (el lápiz mide 20px dentro). */
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  /* text-2 (no text-3): el lápiz es una acción real y debe leerse como tal —
     text-3 daba ~3.2:1 sobre la card (bajo WCAG AA). */
  color: var(--text-2);
  cursor: pointer;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.po-item-edit:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
}

.po-item-edit:hover {
  color: var(--info);
}

/* Eliminar item (Fase 1-P1): delete_outline rojo L887-891 */
.po-item-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Objetivo táctil 44px (el icono mide 20px dentro). */
  width: 44px;
  height: 44px;
  margin-left: 4px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--error); /* red.shade600 */
  cursor: pointer;
}

.po-item-delete:hover:not(:disabled) {
  color: var(--error);
}

.po-item-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Columna qty read-only (estados ≠ pendiente): sin steppers */
.po-item-qty-col--readonly {
  justify-content: center;
  min-width: 28px;
}

/* Botón rojo del confirm de eliminación */
.pay-btn--danger {
  background: var(--error);
  color: #ffffff;
}

.pay-btn--danger:hover:not(:disabled) {
  background: var(--error);
}

.pay-btn--danger:disabled {
  background: #616161;
  color: var(--text-2);
  cursor: not-allowed;
}

.po-remove-text {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
}

.po-divider {
  height: 1px;
  background: var(--border-soft);
  margin: 16px 0;
}

/* Botones (Wrap spaceBetween): izq agregar/tickets, der total/cancelar/cobrar */
.po-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.po-actions-left,
.po-actions-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.po-total {
  color: var(--success); /* green[700] */
  font-size: 20px;
  font-weight: 700;
}

.po-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  /* Objetivo táctil 44px (guía táctil del POS). */
  min-height: 44px;
  padding: 8px 13px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

/* Agregar: acción secundaria neutra */
.po-btn--add {
  color: var(--text-2);
  border-color: var(--border-soft);
}

.po-btn--add:hover {
  color: var(--text-1);
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.04);
}

/* Ticket Cliente */
.po-btn--ticket-client {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 35%, transparent);
}

.po-btn--ticket-client:hover {
  background: var(--info-soft);
  border-color: var(--info);
}

/* Ticket Cocina */
.po-btn--ticket-kitchen {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
}

.po-btn--ticket-kitchen:hover {
  background: rgba(255, 186, 77, 0.12);
  border-color: var(--warning);
}

/* Cancelar Orden: acción destructiva */
.po-btn--cancel {
  color: var(--error);
  border-color: transparent;
}

.po-btn--cancel:hover {
  background: var(--error-soft);
}

.po-cancel-icon {
  color: var(--error);
}

/* Cobrar: ElevatedButton verde (L728-738) */
/* Cobrar: CTA principal del POS (naranja, única acción sólida de la card) */
.po-btn--pay {
  background: var(--primary);
  color: var(--on-primary);
  min-height: 44px;
  padding: 10px 22px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.po-btn--pay:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: var(--shadow-accent);
}

.po-btn--pay:hover {
  background: var(--success);
}

/* ============ MODAL DE PAGO (réplica _showAmountReceivedDialog) ============ */
.pay-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--elevated);
}

.pay-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 440px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.pay-title {
  margin: 0;
  padding: 16px 20px;
  color: var(--text-1);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Botón volver del paso 2 (flecha) — réplica back del AppBar legacy. */
.pay-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: -8px;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-2);
  font-size: 18px;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.pay-back:hover {
  background: var(--card-overlay);
  color: var(--text-1);
}

/* ===== PASO 1: tarjetas Pago Simple / Mixto (réplica L1403-1421) ===== */
.pay-kind {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pay-kind-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 68px;
  padding: 12px 16px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.pay-kind-btn:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.pay-kind-icon {
  font-size: 18px;
  line-height: 1;
  margin-bottom: 4px;
}

.pay-kind-title {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 700;
}

.pay-kind-sub {
  color: var(--text-2);
  font-size: 12.5px;
}

/* ===== Mixto: filas efectivo/tarjeta ===== */
.pay-mix {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pay-mix-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pay-mix-label {
  flex: 0 0 110px;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
}

.pay-mix-input {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  padding: 10px 14px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.pay-mix-input:focus {
  outline: none;
  border-color: var(--primary);
}

.pay-change--mix {
  border-top: 1px solid var(--border-soft);
  padding-top: 10px;
}

/* Nota para tarjeta/transferencia (sin captura) */
.pay-note {
  margin: 0;
  color: var(--text-2);
  font-size: 13.5px;
}

/* Nota de conversión USD (réplica 'Total: $X MXN ≈ $Y USD') */
.pay-usd-note {
  color: var(--text-2);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.pay-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}

.pay-total-line {
  margin: 0;
  color: var(--text-1);
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pay-total-line strong {
  color: var(--text-1);
}

.pay__methods {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.pay__method {
  min-height: 44px;
  padding: 10px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-2);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.pay__method:hover {
  border-color: var(--border);
  color: var(--text-1);
}

.pay__method--selected {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}

/* Monto recibido (TextField outline grey[600], prefix $, verde) */
.pay-amount {
  padding: 12px 14px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-1);
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-height: 24px;
}

.pay-numpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pay-key {
  min-height: 46px;
  padding: 12px 0;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.pay-key:hover {
  background: var(--bg-surface-2);
  border-color: var(--border);
}

.pay-key:active {
  background: var(--primary-soft);
  border-color: var(--primary);
}

.pay-key--clear {
  color: var(--error);
}

.pay-key--exact {
  color: var(--info);
  font-size: 0.8rem;
}

/* Cambio o faltante (Container verde/rojo alpha 0.2, L1568-1600) */
.pay-change {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--success-soft);
  border: 1px solid color-mix(in srgb, var(--success) 45%, transparent);
  border-radius: var(--radius-sm);
  color: var(--success);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pay-change span:last-child {
  color: var(--success);
  font-size: 18px;
  font-weight: 700;
}

.pay-change--missing {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 45%, transparent);
  color: var(--error);
}

.pay-change--missing span:last-child {
  color: var(--error);
}

.pay-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-soft);
}

.pay-btn {
  flex: 1;
  min-height: 46px;
  padding: 12px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.pay-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-2);
}

.pay-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-1);
}

.pay-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

/* Confirmar Pago: verde (L1631-1634); gris si falta monto */
.pay-btn--confirm {
  background: var(--success);
  color: #ffffff;
}

.pay-btn--confirm:hover:not(:disabled) {
  background: var(--success);
}

.pay-btn--confirm:disabled {
  background: #616161;
  color: var(--text-2);
  cursor: not-allowed;
}

@media (max-width: 700px) {
  .po-body {
    padding: 8px;
  }

  .po-filters {
    padding: 8px;
  }

  .po-card-header {
    padding: 10px;
  }

  .po-folio {
    font-size: 14px;
  }

  .po-total-badge {
    font-size: 14px;
  }
}
</style>

