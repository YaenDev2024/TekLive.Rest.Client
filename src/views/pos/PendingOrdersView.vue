<script setup lang="ts">
/**
 * PendingOrdersView · pantalla ÓRDENES del rail (Fase 3 ronda 2).
 *
 * Réplica de pending_orders_screen.dart + widgets/desktop/pending_order_card.dart:
 * - Screen bg grey[900] (#212121), AppBar grey[850] "Órdenes Pendientes" con
 *   botón refresh. El botón Badge de cuentas por cobrar se OMITE (Fase 4).
 * - Barra filtros (bg #303030, padding 12): buscador + icono calendario +
 *   botón fecha + botón "Hoy" + Dropdown de estatus.
 *   El dropdown replica 1:1 las 3 opciones del Flutter (L311-333) mapeadas al
 *   status real del backend Rest: Pendientes → pendiente, Entregadas → pagado,
 *   Todas → sin status (el backend Rest compara ORDER_STATUS exacto; "Todas"
 *   hace una llamada sin filtro y filtra client-side pagadas/canceladas).
 * - PendingOrderCard: bg #303030 radius 12 elev 4 borde 2px (grey #616161
 *   siempre: en Rest no hay EXTERNO/DIDI/UBER aún; _getBorderColor queda listo
 *   con umbral 20 min verde/rojo para cuando exista tipoDeOrden).
 *   Header expandible (chevron + Orden #folio + badge tipo + cajero + fecha +
 *   badge total esquina verde/gris). Timer MM:SS solo si tipo externo existe.
 *   Contenido: items con qty +/- (deuda backend: edición no disponible) y
 *   total verde; botones Agregar/Tickets (deuda) + Cancelar (funcional) +
 *   Cobrar (funcional → POST payment con cambio).
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
} from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import type {
  OrderDetailItem,
  OrderStatus,
  PaymentMethod,
  PendingOrderListItem,
} from '../../api/pos-types'
import { POS_PLANT_ID } from '../../stores/catalog'
import { useCashStore } from '../../stores/cash'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { AppBanner, AppSelect, AppSpinner } from '../../components/ui'
import CancelOrderModal from '../../components/pos/CancelOrderModal.vue'
import { printPendingKitchenTicket, printSaleTickets } from '../../services/ticket'

const ordersStore = useOrdersStore()
const cashStore = useCashStore()
const toast = useToastStore()

// --- Filtros (réplica _filterStatus / _selectedDate / _searchController) ------

/** Opciones EXACTAS del Dropdown Flutter (L315-319). */
type StatusFilter = 'Pendiente' | 'Entregadas' | 'Todas'

const FILTER_STATUS: Record<StatusFilter, string[] | null> = {
  // Flutter: 'Pendiente' → statusFilter backend 'Pendiente' (es-MX mayúscula).
  // Rest compara ORDER_STATUS exacto en minúsculas → 'pendiente'.
  Pendiente: ['pendiente'],
  // Flutter: 'Entregadas' → 'pagado' (las cobradas).
  Entregadas: ['pagado'],
  // Flutter: Todas → null (sin filtro). En Rest, GET /orders sin status
  // devuelve TODAS (incluye pagadas/canceladas): igual que el Flutter.
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
  pollTimer = setInterval(() => {
    void refresh()
  }, POLL_MS)
})

onBeforeUnmount(() => {
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
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

/** Verde si <20 min, rojo si ≥20 (L366-379); gris si no es externa (L367-369). */
function borderColorOf(order: PendingOrderListItem): string {
  if (!needsTimer(order)) return '#616161' // Colors.grey[700]
  const elapsed = Date.now() - new Date(order.createdAt).getTime()
  return elapsed < TIMER_GREEN_MINUTES * 60_000 ? '#4caf50' : '#f44336'
}

/** MM:SS transcurrido (L382-387). */
function formatElapsedTime(order: PendingOrderListItem): string {
  const elapsed = Math.max(0, Date.now() - new Date(order.createdAt).getTime())
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

// --- Detalle expandible (API real con caché, F5) -------------------------------

const expandedId = ref<number | null>(null)
const expandedItems = ref<OrderDetailItem[] | null>(null)
const expandLoading = ref(false)
const expandError = ref<string | null>(null)

async function toggleExpand(orderId: number): Promise<void> {
  if (expandedId.value === orderId) {
    expandedId.value = null
    expandedItems.value = null
    expandError.value = null
    return
  }
  expandedId.value = orderId
  expandError.value = null
  const cached = ordersStore.detailCache[orderId]
  if (cached != null) {
    expandedItems.value = cached.items
    return
  }
  expandedItems.value = null
  expandLoading.value = true
  const detail = await ordersStore.fetchOrderDetail(orderId)
  expandLoading.value = false
  if (expandedId.value !== orderId) return // se cambió de fila mientras cargaba
  if (detail == null) {
    expandedItems.value = null
    expandError.value = ordersStore.detailError ?? 'No se pudo cargar el detalle.'
    return
  }
  expandedItems.value = detail.items
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

// --- Deudas backend (editar detalle / impresión): toast informativo ------------

function todoEditOrder(): void {
  toast.info('Edición de órdenes disponible próximamente')
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

type ModalState =
  | { kind: 'none' }
  | { kind: 'cancel'; order: PendingOrderListItem }
  | { kind: 'pay'; order: PendingOrderListItem }

const modal = ref<ModalState>({ kind: 'none' })

// --- Cobro (réplica _showAmountReceivedDialog de order_panel.dart L167-320) ----

const payMethod = ref<PaymentMethod>('efectivo')
const payAmountText = ref('')
const paySubmitting = ref(false)
const payError = ref<string | null>(null)

function openPay(order: PendingOrderListItem): void {
  modal.value = { kind: 'pay', order }
  payMethod.value = 'efectivo'
  payAmountText.value = ''
  payError.value = null
}

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
  if (payMethod.value === 'tarjeta' || modal.value.kind !== 'pay') return 0
  return Math.max(0, (payAmount.value ?? 0) - modal.value.order.total)
})

const payProblem = computed<string | null>(() => {
  if (modal.value.kind !== 'pay') return null
  if (payMethod.value === 'tarjeta') return null
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
    const amount =
      payMethod.value === 'tarjeta' ? order.total : (payAmount.value ?? order.total)
    const result = await ordersStore.payExistingOrder(order.id, {
      method: payMethod.value,
      amountReceived: amount,
      expectedStatus: order.orderStatus as OrderStatus,
      // Atribuye el cobro a la sesión de caja abierta (ronda cash).
      ...(cashStore.hasOpenSession ? { cashSessionId: cashStore.sessionId } : {}),
    })
    if (result != null) {
      toast.success(
        `Orden #${order.dailyOrderNumber} cobrada — cambio: $${result.changeAmount.toFixed(2)}`,
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
        <label class="po-date-btn">
          <input
            type="date"
            class="po-date-input"
            :value="selectedDate"
            aria-label="Seleccionar fecha"
            data-testid="orders-date"
            @change="onDateChange"
          />
          <span class="po-date-label">{{ formatDateLabel(selectedDate) }}</span>
        </label>
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
             confirma la opción tocada); setter dispara la recarga -->
        <AppSelect
          v-model="filterModel"
          :options="[
            { value: 'Pendiente', label: 'Pendientes' },
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
            <!-- Badge del total en la esquina (verde si pendiente, gris si no) -->
            <span
              class="po-total-badge"
              :class="{ 'po-total-badge--pending': order.orderStatus === 'pendiente' }"
              :data-testid="`order-total-${order.id}`"
            >
              <DollarSign :size="18" aria-hidden="true" />
              {{ order.total.toFixed(2) }}
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
                <!-- Columna qty: remove rojo / cantidad / add teal -->
                <span class="po-item-qty-col">
                  <button
                    type="button"
                    class="po-item-qty-btn po-item-qty-btn--remove"
                    :aria-label="`Reducir ${item.productName}`"
                    :data-testid="`item-minus-${item.id}`"
                    @click="todoEditOrder"
                  >
                    <CircleMinus :size="22" aria-hidden="true" />
                  </button>
                  <span class="po-item-qty">{{ item.quantity }}</span>
                  <button
                    type="button"
                    class="po-item-qty-btn po-item-qty-btn--add"
                    :aria-label="`Aumentar ${item.productName}`"
                    :data-testid="`item-plus-${item.id}`"
                    @click="todoEditOrder"
                  >
                    <CirclePlus :size="22" aria-hidden="true" />
                  </button>
                </span>

                <span class="po-item-info">
                  <span class="po-item-name">
                    {{ item.productName }}
                    <span v-if="itemNoteLines(item.notes).length > 0" class="po-item-notes">
                      <span v-for="line in itemNoteLines(item.notes)" :key="line" class="po-item-note">
                        • {{ line }}
                      </span>
                    </span>
                  </span>
                </span>

                <span class="po-item-actions">
                  <button
                    type="button"
                    class="po-item-edit"
                    :aria-label="`Editar ${item.productName}`"
                    @click="todoEditOrder"
                  >
                    <Pencil :size="20" aria-hidden="true" />
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
                  @click="todoEditOrder"
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
                  {{ formatMoney(order.total) }}
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

    <!-- Modal de pago (réplica _showAmountReceivedDialog) -->
    <div
      v-if="modal.kind === 'pay'"
      class="pay-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Monto Recibido"
    >
      <div class="pay-card" data-testid="pay-modal">
        <h2 class="pay-title">Monto Recibido</h2>
        <div class="pay-body">
          <p class="pay-total-line">
            Total a pagar: <strong>{{ formatMoney(modal.order.total) }}</strong>
          </p>

          <div class="pay__methods" role="radiogroup" aria-label="Método de pago">
            <button
              v-for="m in (['efectivo', 'tarjeta'] as const)"
              :key="m"
              type="button"
              class="pay__method"
              :class="{ 'pay__method--selected': payMethod === m }"
              role="radio"
              :aria-checked="payMethod === m"
              @click="payMethod = m"
            >
              {{ m.charAt(0).toUpperCase() + m.slice(1) }}
            </button>
          </div>

          <template v-if="payMethod !== 'tarjeta'">
            <div class="pay-amount" data-testid="pay-amount-display">
              {{ payAmountText === '' ? '$0.00' : `$${payAmountText}` }}
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
                @click="payAmountText = modal.kind === 'pay' ? modal.order.total.toFixed(2) : ''"
              >
                Exacto
              </button>
            </div>
            <div
              v-if="modal.kind === 'pay'"
              class="pay-change"
              :class="{ 'pay-change--missing': (payAmount ?? 0) < modal.order.total }"
              data-testid="pay-change"
              aria-live="polite"
            >
              <span>{{ (payAmount ?? 0) < modal.order.total ? 'Falta:' : 'Cambio:' }}</span>
              <span>{{ formatMoney(Math.abs(payChange)) }}</span>
            </div>
          </template>

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
  background: var(--bg); /* grey[900] #212121 */
}

/* AppBar (grey[850] #303030, title 20 bold, refresh a la derecha) */
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

.po-icon-btn:hover {
  background: var(--card-overlay);
}

/* ============ BARRA FILTROS (container bg #303030, padding 12) ============ */
.po-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-surface);
}

/* Buscador: fill #212121, radius 8, borde #616161, icono búsqueda 18 gris */
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
  padding: 8px 10px 8px 34px;
  background: var(--bg); /* grey[900] */
  border: 1px solid var(--border); /* #616161 */
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.po-search-input::placeholder {
  color: #9e9e9e; /* grey[500] */
}

.po-search-input:focus {
  border-color: var(--primary);
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

/* Botón fecha (ElevatedButton.icon grey[800]) — label + input date invisible */
.po-date-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: #424242; /* grey[800] */
  border-radius: 8px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
}

.po-date-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: 0;
}

.po-today-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
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
  color: #9e9e9e; /* grey[500] */
}

.po-state-text {
  margin: 0;
  color: var(--text);
}

.po-state-empty {
  margin: 0;
  color: #bdbdbd; /* grey[400] */
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
  background: var(--bg-surface);
  border: 2px solid #616161;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Header (bg grey[800] #424242, borde inferior grey[700]) */
.po-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 16px;
  background: #424242;
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
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
  color: var(--text);
  font-size: 18px;
  font-weight: 700;
}

/* Badge tipo (L2271-2326): local gris / externo azul / uber-didi naranja /
   transfer púrpura */
.po-type-badge {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.po-type-badge--local {
  background: #616161; /* grey[700] */
}

.po-type-badge--externo {
  background: #1976d2; /* blue[700] */
}

.po-type-badge--uber-didi {
  background: #ef6c00; /* orange[700] */
}

.po-type-badge--transfer {
  background: #7b1fa2; /* purple[700] */
}

.po-customer {
  color: #dcdcdc; /* grey[300] */
  font-size: 14px;
}

/* Timer chip externo (L474-509): borde/bg color del borde, MM:SS bold */
.po-timer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 4px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 13px;
  font-weight: 700;
}

.po-created {
  color: #9e9e9e; /* grey[500] */
  font-size: 12px;
}

/* Badge del total en la esquina (L608-643): pill verde si pendiente, gris si no */
.po-total-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid #757575; /* grey[600] */
  border-radius: 999px;
  background: rgba(117, 117, 117, 0.15);
  color: #bdbdbd; /* grey[400] */
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.po-total-badge--pending {
  border-color: #388e3c; /* green[700] */
  background: rgba(27, 94, 32, 0.15); /* green[900] alpha .15 */
  color: #388e3c;
}

/* ===== Contenido expandible (padding 16) ===== */
.po-card-content {
  padding: 16px;
  background: var(--bg-surface);
}

.po-content-title {
  margin: 0 0 12px;
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
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
  color: #9e9e9e;
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
  background: #424242;
  border: 1px solid var(--border);
  border-radius: 8px;
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
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.po-item-qty-btn--remove {
  color: #ef9a9a; /* red[400] aprox (Flutter red.shade400) */
}

.po-item-qty-btn--remove:hover {
  color: var(--error);
}

.po-item-qty-btn--add {
  color: #81c784; /* green[300] aprox (Flutter green.shade400) */
}

.po-item-qty-btn--add:hover {
  color: var(--success);
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

/* Notas (L890-940): gris 12 itálica con bullet */
.po-item-notes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.po-item-note {
  color: #bdbdbd; /* grey[400] */
  font-size: 12px;
  font-style: italic;
}

.po-item-edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: #42a5f5; /* blue[600] aprox (Flutter blue.shade600) */
  cursor: pointer;
}

.po-item-edit:hover {
  color: var(--info);
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
  color: #388e3c; /* green[700] */
  font-size: 20px;
  font-weight: 700;
}

.po-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

/* Agregar: outlined teal (L676-684) */
.po-btn--add {
  color: #26a69a; /* teal aprox */
  border-color: #00897b; /* teal[700] */
}

.po-btn--add:hover {
  background: rgba(38, 166, 154, 0.15);
}

/* Ticket Cliente: outlined blue (L685-693) */
.po-btn--ticket-client {
  color: #42a5f5; /* blue */
  border-color: #1976d2; /* blue[700] */
}

.po-btn--ticket-client:hover {
  background: rgba(66, 165, 245, 0.15);
}

/* Ticket Cocina: outlined orange (L694-702) */
.po-btn--ticket-kitchen {
  color: #ffa726; /* orange */
  border-color: #ef6c00; /* orange[700] */
}

.po-btn--ticket-kitchen:hover {
  background: rgba(255, 167, 38, 0.15);
}

/* Cancelar Orden: text button rojo (L720-727) */
.po-btn--cancel {
  color: var(--error);
}

.po-btn--cancel:hover {
  background: rgba(255, 82, 82, 0.15);
}

.po-cancel-icon {
  color: var(--error);
}

/* Cobrar: ElevatedButton verde (L728-738) */
.po-btn--pay {
  background: var(--success);
  color: #ffffff;
  padding: 12px 24px;
}

.po-btn--pay:hover {
  background: #43a047;
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
  background: rgba(0, 0, 0, 0.6);
}

.pay-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 440px;
  background: var(--bg-surface); /* grey[850] */
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.pay-title {
  margin: 0;
  padding: 16px 20px;
  color: var(--text);
  font-size: 1.15rem;
  font-weight: 700;
  border-bottom: 1px solid var(--border-soft);
}

.pay-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}

.pay-total-line {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  font-weight: 700;
}

.pay-total-line strong {
  color: var(--text);
}

.pay__methods {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.pay__method {
  padding: 10px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.pay__method--selected {
  border-color: var(--primary);
  background: rgba(255, 87, 34, 0.12);
  color: var(--primary);
}

/* Monto recibido (TextField outline grey[600], prefix $, verde) */
.pay-amount {
  padding: 12px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 1.3rem;
  font-weight: 700;
  text-align: right;
  min-height: 24px;
}

.pay-numpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pay-key {
  padding: 12px 0;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
}

.pay-key:hover {
  background: var(--border-soft);
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
  background: rgba(76, 175, 80, 0.2); /* green alpha .2 */
  border: 1px solid var(--success);
  border-radius: 8px;
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
}

.pay-change span:last-child {
  color: var(--success);
  font-size: 18px;
  font-weight: 700;
}

.pay-change--missing {
  background: rgba(255, 82, 82, 0.2); /* red alpha .2 */
  border-color: var(--error);
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
  padding: 12px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.pay-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
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
  background: #43a047;
}

.pay-btn--confirm:disabled {
  background: #616161;
  color: #bdbdbd;
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

