<script setup lang="ts">
/**
 * PendingOrdersView · órdenes pendientes del POS Piso 1 (Fase 3b).
 *
 * Réplica de pending_orders_screen.dart: listado con POLLING cada 15s
 * (clearInterval en onUnmounted), acciones por fila según estado:
 * - Cobrar (modal pago con cambio; 409 → banner con currentStatus).
 * - Avanzar estado: pendiente → preparando → listo → entregado (PATCH
 *   con expectedStatus; 409 → banner).
 * - Cancelar (modal con nota obligatoria; 403 manejado).
 *
 * Se renderiza como panel modal sobre el POS (esta ronda); ruta propia
 * /pos/piso1/pendientes también registrada para QA directo.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import type {
  OrderStatus,
  PaymentMethod,
  PendingOrderListItem,
} from '../../api/pos-types'
import { POS_PLANT_ID } from '../../stores/catalog'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { AppBanner, AppSpinner } from '../../components/ui'
import AppModal from '../../components/pos/AppModal.vue'
import CancelOrderModal from '../../components/pos/CancelOrderModal.vue'

const emit = defineEmits<{ close: [] }>()

const ordersStore = useOrdersStore()
const toast = useToastStore()

// --- Polling 15s -------------------------------------------------------------

const POLL_MS = 15_000
let pollTimer: ReturnType<typeof setInterval> | null = null

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function refresh(): Promise<void> {
  await ordersStore.fetchPendingOrders(POS_PLANT_ID, todayIso())
}

onMounted(() => {
  void refresh()
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

// --- Acciones por fila ---------------------------------------------------------

/** Flujo de estados: botón "avanzar" según estado actual. */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pendiente: 'preparando',
  preparando: 'listo',
  listo: 'entregado',
}

const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  pendiente: 'Preparar',
  preparando: 'Marcar listo',
  listo: 'Entregar',
}

function nextStatusOf(status: string): OrderStatus | null {
  return NEXT_STATUS[status as OrderStatus] ?? null
}

function advanceLabelOf(status: string): string {
  return ADVANCE_LABEL[status as OrderStatus] ?? 'Avanzar'
}

const busyOrderId = ref<number | null>(null)
/** Banner de conflicto por orden (409): orderId → currentStatus. */
const rowConflict = ref<Map<number, OrderStatus | 'not-found'>>(new Map())

async function advance(order: PendingOrderListItem): Promise<void> {
  const target = nextStatusOf(order.orderStatus)
  if (target == null || busyOrderId.value != null) return
  busyOrderId.value = order.id
  rowConflict.value.delete(order.id)
  try {
    const result = await ordersStore.advanceOrder(order.id, {
      expectedStatus: order.orderStatus as OrderStatus,
      newStatus: target,
    })
    if (result === true) {
      toast.success(`Orden #${order.dailyOrderNumber} → ${target}`)
      await refresh()
    } else {
      const conflict = ordersStore.lastConflict
      if (conflict != null) {
        rowConflict.value.set(order.id, conflict.currentStatus)
        if (conflict.currentStatus !== 'not-found') await refresh()
      }
    }
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'No se pudo conectar con el servidor.',
    )
  } finally {
    busyOrderId.value = null
  }
}

// --- Cobro inline (mini-modal de pago) ----------------------------------------

type PayModalState = {
  kind: 'none'
} | {
  kind: 'pay'
  order: PendingOrderListItem
} | {
  kind: 'cancel'
  order: PendingOrderListItem
}

const payModal = ref<PayModalState>({ kind: 'none' })
const payMethod = ref<PaymentMethod>('efectivo')
const payAmountText = ref('')
const paySubmitting = ref(false)
const payError = ref<string | null>(null)

function openPay(order: PendingOrderListItem): void {
  payModal.value = { kind: 'pay', order }
  payMethod.value = 'efectivo'
  payAmountText.value = ''
  payError.value = null
}

function openCancel(order: PendingOrderListItem): void {
  payModal.value = { kind: 'cancel', order }
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
  if (payMethod.value === 'tarjeta' || payModal.value.kind !== 'pay') return 0
  return Math.max(0, (payAmount.value ?? 0) - payModal.value.order.total)
})

const payProblem = computed<string | null>(() => {
  if (payModal.value.kind !== 'pay') return null
  if (payMethod.value === 'tarjeta') return null
  if (payAmount.value == null) return 'Captura el monto con el que paga el cliente.'
  if (payAmount.value <= 0) return 'El monto debe ser mayor a 0.'
  if (payAmount.value < payModal.value.order.total) {
    return `El monto debe ser ≥ $${payModal.value.order.total.toFixed(2)}.`
  }
  return null
})

async function confirmPay(): Promise<void> {
  if (payModal.value.kind !== 'pay') return
  if (payProblem.value != null) {
    payError.value = payProblem.value
    return
  }
  const order = payModal.value.order
  paySubmitting.value = true
  payError.value = null
  try {
    const amount =
      payMethod.value === 'tarjeta' ? order.total : (payAmount.value ?? order.total)
    const result = await ordersStore.payExistingOrder(order.id, {
      method: payMethod.value,
      amountReceived: amount,
      expectedStatus: order.orderStatus as OrderStatus,
    })
    if (result != null) {
      toast.success(
        `Venta #${order.dailyOrderNumber} cobrada — cambio: $${result.changeAmount.toFixed(2)}`,
      )
      payModal.value = { kind: 'none' }
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

// --- Detalle expandible (mock) ---------------------------------------------------

const expandedId = ref<number | null>(null)

function toggleExpand(orderId: number): void {
  expandedId.value = expandedId.value === orderId ? null : orderId
}

const expandedItems = computed(() => {
  if (expandedId.value == null) return null
  return ordersStore.getMockOrderDetail(expandedId.value)?.items ?? null
})

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function statusClass(status: string): string {
  switch (status) {
    case 'pendiente':
      return 'warning'
    case 'preparando':
      return 'info'
    case 'listo':
      return 'success'
    case 'entregado':
      return 'muted'
    case 'cancelada':
      return 'error'
    default:
      return 'muted'
  }
}

const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '←'] as const
</script>

<template>
  <AppModal title="Órdenes pendientes · Piso 1" :width="860" @close="emit('close')">
    <div class="pnd">
      <div v-if="ordersStore.loading && ordersStore.pendingOrders.length === 0" class="pnd__state">
        <AppSpinner :size="28" tone="primary" />
        <p>Cargando órdenes…</p>
      </div>

      <template v-else>
        <AppBanner v-if="ordersStore.error" type="error">{{ ordersStore.error }}</AppBanner>

        <div v-if="ordersStore.pendingOrders.length === 0 && !ordersStore.error" class="pnd__state">
          <p>No hay órdenes pendientes.</p>
        </div>

        <ul v-else class="pnd__list" data-testid="pending-list">
          <li v-for="order in ordersStore.pendingOrders" :key="order.id" class="pnd__row">
            <div class="pnd__row-main">
              <div class="pnd__row-info">
                <span class="pnd__folio" :data-testid="`order-${order.id}`">
                  #{{ order.dailyOrderNumber }}
                </span>
                <span :class="['pnd__status', `pnd__status--${statusClass(order.orderStatus)}`]">
                  {{ order.orderStatus }}
                </span>
                <span class="pnd__meta">{{ order.itemCount }} art. · {{ formatTime(order.createdAt) }} · {{ order.waiterName }}</span>
              </div>
              <span class="pnd__total">{{ formatMoney(order.total) }}</span>
            </div>

            <div class="pnd__row-actions">
              <button
                v-if="nextStatusOf(order.orderStatus) != null"
                type="button"
                class="pnd__act pnd__act--advance"
                :disabled="busyOrderId === order.id"
                :data-testid="`advance-${order.id}`"
                @click="advance(order)"
              >
                {{ advanceLabelOf(order.orderStatus) }}
              </button>
              <button
                type="button"
                class="pnd__act pnd__act--pay"
                :data-testid="`pay-${order.id}`"
                @click="openPay(order)"
              >
                Cobrar
              </button>
              <button
                type="button"
                class="pnd__act pnd__act--cancel"
                :data-testid="`cancel-${order.id}`"
                @click="openCancel(order)"
              >
                Cancelar
              </button>
              <button
                type="button"
                class="pnd__act pnd__act--expand"
                :aria-expanded="expandedId === order.id"
                :aria-label="`Ver detalle de #${order.dailyOrderNumber}`"
                @click="toggleExpand(order.id)"
              >
                <ChevronUp v-if="expandedId === order.id" :size="14" />
                <ChevronDown v-else :size="14" />
              </button>
            </div>

            <AppBanner
              v-if="rowConflict.get(order.id) != null"
              type="warning"
            >
              Conflicto: la orden ahora está
              "{{ rowConflict.get(order.id) }}". Lista actualizada.
            </AppBanner>

            <ul v-if="expandedId === order.id && expandedItems != null" class="pnd__items">
              <li v-for="item in expandedItems" :key="item.id" class="pnd__item">
                <span>{{ item.quantity }}× {{ item.productName }}</span>
                <span>{{ formatMoney(item.price * item.quantity) }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </div>

    <!-- Modal de pago inline -->
    <AppModal
      v-if="payModal.kind === 'pay'"
      :title="`Cobrar #${payModal.order.dailyOrderNumber}`"
      :width="460"
      :dismissible="!paySubmitting"
      @close="payModal = { kind: 'none' }"
    >
      <div class="pay">
        <div class="pay__total">
          <span>Total</span>
          <strong>{{ formatMoney(payModal.order.total) }}</strong>
        </div>

        <div class="pay__methods" role="radiogroup" aria-label="Método de pago">
          <button
            v-for="m in (['efectivo', 'tarjeta', 'ambos'] as const)"
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
          <div class="pay__amount" data-testid="pay-amount-display">
            {{ payAmountText === '' ? '$0.00' : `$${payAmountText}` }}
          </div>
          <div class="pay__numpad">
            <button
              v-for="key in numpadKeys"
              :key="key"
              type="button"
              class="pay__key"
              @click="pressPayKey(key)"
            >
              {{ key }}
            </button>
            <button type="button" class="pay__key pay__key--clear" @click="pressPayKey('C')">C</button>
            <button
              type="button"
              class="pay__key pay__key--exact"
              @click="payAmountText = payModal.order.total.toFixed(2)"
            >
              Exacto
            </button>
          </div>
          <div class="pay__change" data-testid="pay-change" aria-live="polite">
            <span>Cambio</span>
            <span>{{ formatMoney(payChange) }}</span>
          </div>
        </template>

        <AppBanner v-if="payError" type="error">{{ payError }}</AppBanner>
      </div>

      <template #footer>
        <button
          type="button"
          class="pnd__act pnd__act--cancel"
          :disabled="paySubmitting"
          @click="payModal = { kind: 'none' }"
        >
          Volver
        </button>
        <button
          type="button"
          class="pnd__act pnd__act--pay pnd__act--confirm"
          :disabled="paySubmitting || payProblem != null"
          data-testid="confirm-pay"
          @click="confirmPay"
        >
          {{ paySubmitting ? 'Procesando…' : 'Confirmar pago' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal de cancelación (nota obligatoria, 403 manejado) -->
    <CancelOrderModal
      v-if="payModal.kind === 'cancel'"
      :order="payModal.order"
      @close="payModal = { kind: 'none' }"
      @cancelled="refresh"
    />
  </AppModal>
</template>

<style scoped>
.pnd {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.pnd__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px;
  color: var(--text-muted);
}

.pnd__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pnd__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--input-bg);
  border-radius: var(--radius);
}

.pnd__row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pnd__row-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pnd__folio {
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 700;
}

.pnd__status {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pnd__status--warning {
  background: rgba(255, 152, 0, 0.15);
  color: var(--warning);
}

.pnd__status--info {
  background: rgba(33, 150, 243, 0.15);
  color: var(--info);
}

.pnd__status--success {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.pnd__status--error {
  background: rgba(255, 82, 82, 0.15);
  color: var(--error);
}

.pnd__status--muted {
  background: var(--card-overlay);
  color: var(--text-faint);
}

.pnd__meta {
  color: var(--text-faint);
  font-size: 0.8rem;
}

.pnd__total {
  color: var(--primary);
  font-size: 1.1rem;
  font-weight: 700;
}

.pnd__row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pnd__act {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pnd__act:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.pnd__act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pnd__act--advance {
  border-color: var(--info);
  color: var(--info);
}

.pnd__act--pay {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.pnd__act--pay:hover:not(:disabled) {
  background: var(--primary-hover);
  color: var(--on-primary);
  border-color: var(--primary-hover);
}

.pnd__act--confirm {
  flex: 1;
  justify-content: center;
}

.pnd__act--cancel:hover:not(:disabled) {
  color: var(--error);
  border-color: var(--error);
}

.pnd__act--expand {
  padding: 8px 10px;
}

.pnd__items {
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--card-overlay);
  border-radius: var(--radius);
}

.pnd__item {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* Modal de pago */
.pay {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pay__total {
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--input-bg);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 1.1rem;
}

.pay__total strong {
  color: var(--primary);
  font-size: 1.3rem;
}

.pay__methods {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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

.pay__amount {
  padding: 12px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 1.3rem;
  font-weight: 700;
  text-align: right;
  min-height: 24px;
}

.pay__numpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pay__key {
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

.pay__key:hover {
  background: var(--border-soft);
}

.pay__key--clear {
  color: var(--error);
}

.pay__key--exact {
  color: var(--info);
  font-size: 0.8rem;
}

.pay__change {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--input-bg);
  border-radius: var(--radius);
  color: var(--text-muted);
}

.pay__change span:last-child {
  color: var(--success);
  font-weight: 700;
  font-size: 1.1rem;
}
</style>
