<script setup lang="ts">
/**
 * CheckoutModal · cobro del carrito (Fase 3b + ronda cash/impresión).
 *
 * Métodos réplica del POS original (order_panel.dart L104-143, diálogo
 * 'Selecciona método de pago'): Efectivo | Tarjeta | QR/Transferencia |
 * Dólares — grid 2x2. Método interno: efectivo|tarjeta|transferencia|dolares
 * ('ambos' sigue existiendo en el tipo TS pero NO es botón de este modal).
 *
 * - Tarjeta: sin captura (amountReceived = total) — L631-633.
 * - QR/Transferencia: sin captura, nota 'Pago con QR o transferencia' — L628-630.
 * - Dólares: numpad USD + display 'Total: $X MXN ≈ $Y USD' (L598-627);
 *   rate null → banner '⚠️ Precio del dólar no configurado' y bloqueo.
 *   Envía { method:'dolares', amountReceivedUsd } — el MXN lo calcula el
 *   backend server-side.
 * - cashSessionId: al submit se incluye si hay sesión abierta; sin sesión en
 *   efectivo/dólares → banner warning NO bloqueante (réplica del StateError
 *   de pending_payments_screen.dart L616-617, aquí informativo).
 * - Success: captura snapshot items/total/orderType ANTES de cart.clear() e
 *   imprime SILENCIOSO (printSaleTickets: cocina x2 keywords + cliente). Si
 *   el navegador bloquea el diálogo → success con 'Imprimir ticket' para
 *   reintentar (réplica: el original nunca muestra preview).
 */
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '../../api/client'
import type { CreatedOrderResponse } from '../../api/pos-types'
import { useCartStore } from '../../stores/cart'
import { useCashStore } from '../../stores/cash'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { POS_PLANT_ID, POS_SUCURSAL_ID } from '../../stores/catalog'
import { session } from '../../services/auth'
import { printSaleTickets } from '../../services/ticket'
import { AppBanner } from '../ui'
import AppModal from './AppModal.vue'

const emit = defineEmits<{ close: [] }>()

const cart = useCartStore()
const cashStore = useCashStore()
const ordersStore = useOrdersStore()
const toast = useToastStore()

/** Botones del modal (labels réplica del diálogo Flutter L115-137). */
type CheckoutMethod = 'efectivo' | 'tarjeta' | 'transferencia' | 'dolares'

const METHOD_LABELS: Record<CheckoutMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'QR/Transferencia',
  dolares: 'Dólares',
}

type Step = 'form' | 'success'

const step = ref<Step>('form')
const method = ref<CheckoutMethod>('efectivo')
/** Texto crudo del input numérico ('' = vacío, obliga a capturar). */
const amountText = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)
/** 409 u otro error al crear la orden (mostrado inline, modal abierto). */
const submitError = ref<string | null>(null)

const saleResult = ref<CreatedOrderResponse | null>(null)
/** Datos para imprimir tras cart.clear() (el carrito ya no tiene items). */
interface SaleSnapshot {
  items: typeof cart.lines
  total: number
  orderType: string
  platformDeliveryInfo: string
  orderId: number | null
  folio: string | null
  /** Estado PAGADO del ticket (la venta ya se cobró). */
  paymentMethod: 'efectivo' | 'tarjeta' | 'transferencia' | 'dolares'
  amountReceived: number
  changeAmount: number
  /** Tasa USD usada (solo dolares). */
  dollarRate?: number
}
const saleSnapshot = ref<SaleSnapshot | null>(null)

const total = computed(() => cart.total)

onMounted(() => {
  // cashSessionId: asegura current (fetch barato; no bloquea el modal).
  if (cashStore.current == null) {
    void cashStore.fetchCurrent()
  }
  // La tasa dólar alimenta el display '≈ $Y USD' del método Dólares.
  if (cashStore.dollarRate == null) {
    void cashStore.fetchDollarRate()
  }
})

/** Numpad: agrega dígito/punto al monto (teclado POS). */
function pressKey(key: string): void {
  if (key === 'C') {
    amountText.value = ''
    return
  }
  if (key === '←') {
    amountText.value = amountText.value.slice(0, -1)
    return
  }
  // Un solo punto decimal.
  if (key === '.' && amountText.value.includes('.')) return
  // Máximo razonable: 8 dígitos.
  const digits = amountText.value.replaceAll('.', '')
  if (key !== '.' && digits.length >= 8) return
  amountText.value += key
}

const amountReceived = computed<number | null>(() => {
  const trimmed = amountText.value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
})

const rate = computed(() => cashStore.rate)

/** ¿Método con numpad de captura? (tarjeta y transferencia van sin captura). */
const needsCapture = computed(() => method.value === 'efectivo' || method.value === 'dolares')

/** Dólares sin tasa configurada → bloqueado (réplica L601-613). */
const dollarRateProblem = computed<boolean>(() => method.value === 'dolares' && rate.value <= 0)

/**
 * Equivalente MXN del total en dólares (display '≈ $Y USD' — L616-617:
 * dollarsNeeded = total / rate).
 */
const totalUsdNeeded = computed<number>(() =>
  rate.value > 0 ? total.value / rate.value : 0,
)

const change = computed<number>(() => {
  if (method.value === 'tarjeta' || method.value === 'transferencia') return 0
  return Math.max(0, (amountReceived.value ?? 0) - (method.value === 'dolares' ? totalUsdNeeded.value : total.value))
})

/** Falta monto o es menor al exigido (solo efectivo/dólares). */
const amountProblem = computed<string | null>(() => {
  if (method.value === 'tarjeta' || method.value === 'transferencia') return null
  if (dollarRateProblem.value) return null // el banner de tasa ya lo cubre
  if (amountReceived.value == null) return 'Captura el monto con el que paga el cliente.'
  if (amountReceived.value <= 0) return 'El monto debe ser mayor a 0.'
  if (method.value === 'dolares') {
    // Réplica order_panel.dart L312-317 adaptado a dólares: usd*rate >= total.
    const usdNeeded = totalUsdNeeded.value
    if (amountReceived.value < usdNeeded) {
      return `Ingresa al menos $${usdNeeded.toFixed(2)} USD`
    }
    return null
  }
  if (amountReceived.value < total.value) {
    return `El cliente pagó $${amountReceived.value.toFixed(2)} pero el total es $${total.value.toFixed(2)}.`
  }
  return null
})

/**
 * Sin sesión de caja en métodos con efectivo físico → warning NO bloqueante
 * (texto EXACTO de pending_payments_screen.dart L616-617 con Piso 1).
 */
const cashSessionWarning = computed<boolean>(() =>
  (method.value === 'efectivo' || method.value === 'dolares') && !cashStore.hasOpenSession,
)

const canConfirm = computed<boolean>(() =>
  amountProblem.value == null && !dollarRateProblem.value && !submitting.value)

async function confirm(): Promise<void> {
  formError.value = null
  submitError.value = null
  if (amountProblem.value != null) {
    formError.value = amountProblem.value
    return
  }
  if (dollarRateProblem.value) return

  // Dólares: el MXN lo calcula el backend con la tasa server-side — el
  // cliente envía SOLO el USD capturado (ronda cash). amountReceived viaja
  // con el equivalente para el flujo de cambio del POS.
  const payment =
    method.value === 'tarjeta' || method.value === 'transferencia'
      ? { method: method.value as 'tarjeta' | 'transferencia', amountReceived: total.value }
      : method.value === 'dolares'
        ? {
            method: 'dolares' as const,
            amountReceived: (amountReceived.value ?? 0) * rate.value,
            amountReceivedUsd: amountReceived.value ?? 0,
          }
        : { method: 'efectivo' as const, amountReceived: amountReceived.value ?? 0 }

  submitting.value = true
  try {
    const created = await ordersStore.submitOrder(
      {
        plantId: POS_PLANT_ID,
        sucursalId: POS_SUCURSAL_ID,
        tableId: 1,
        orderType: cart.orderType,
        ...(cart.customerId != null ? { customerId: cart.customerId } : {}),
        ...(cart.platformDeliveryInfo !== ''
          ? { platformDeliveryInfo: cart.platformDeliveryInfo }
          : {}),
        // Ronda cash: id de la sesión abierta (omitido si no hay caja).
        ...(cashStore.hasOpenSession ? { cashSessionId: cashStore.sessionId } : {}),
        payment,
        items: cart.toOrderItems(),
      },
      session.displayName ?? 'Cajero',
    )

    // Snapshot ANTES de cart.clear() (la impresión necesita items).
    saleSnapshot.value = {
      items: [...cart.lines],
      total: created.total,
      orderType: cart.orderType,
      platformDeliveryInfo: cart.platformDeliveryInfo,
      orderId: created.id,
      folio: created.dailyOrderNumber.toString(),
      // Estado PAGADO del ticket: la venta ya se cobró (layout-client L1146+).
      paymentMethod: payment.method,
      amountReceived:
        payment.method === 'dolares'
          ? (amountReceived.value ?? 0)
          : (payment.amountReceived ?? total.value),
      changeAmount: created.changeAmount ?? 0,
      dollarRate: payment.method === 'dolares' ? rate.value : undefined,
    }
    saleResult.value = created
    cart.clear()

    // Auto-impresión SILENCIOSA (réplica order_provider.dart L636-648):
    // cocina (+duplicado si keywords) + cliente → 1 print del navegador.
    // El original NUNCA muestra preview: imprime, toast '✓ Orden
    // procesada' y cierra TODO al instante.
    const snap = saleSnapshot.value
    let printed = false
    if (snap != null) {
      printed = printSaleTickets({
        folio: snap.folio ?? String(snap.orderId ?? ''),
        orderType: snap.orderType,
        platformDeliveryInfo: snap.platformDeliveryInfo,
        items: snap.items,
        total: snap.total,
        paidState: {
          paymentMethod: snap.paymentMethod,
          amountReceived: snap.amountReceived,
          changeAmount: snap.changeAmount,
          dollarRate: snap.dollarRate,
        },
        orderId: snap.orderId,
      })
    }
    if (printed) {
      // Flujo normal: sin pantallas intermedias (réplica L651-688).
      finish()
    } else {
      // Fallback: el navegador bloqueó el diálogo → success con botón
      // 'Imprimir ticket' para reintentar (no se pierde la venta).
      step.value = 'success'
    }
  } catch (err) {
    submitError.value =
      err instanceof ApiError && err.status !== 0
        ? `Error al crear la venta: ${err.message}`
        : 'No se pudo conectar con el servidor. Verifica tu conexión.'
  } finally {
    submitting.value = false
  }
}

function finish(): void {
  // Ronda 3: toast EXACTO del Flutter (order_panel.dart L661-687): '✓ Orden
  // procesada' + segunda línea '💵 Cambio: $X' solo si cambio > 0.01.
  const change = saleResult.value?.changeAmount ?? 0
  const changeText = change > 0.01 ? `\n💵 Cambio: $${change.toFixed(2)}` : ''
  toast.success('✓ Orden procesada' + changeText)
  emit('close')
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** Fallback: reintenta la impresión silenciosa completa (cocina+cliente). */
function retryPrint(): void {
  const snap = saleSnapshot.value
  if (snap == null) return
  printSaleTickets({
    folio: snap.folio ?? String(snap.orderId ?? ''),
    orderType: snap.orderType,
    platformDeliveryInfo: snap.platformDeliveryInfo,
    items: snap.items,
    total: snap.total,
    paidState: {
      paymentMethod: snap.paymentMethod,
      amountReceived: snap.amountReceived,
      changeAmount: snap.changeAmount,
      dollarRate: snap.dollarRate,
    },
    orderId: snap.orderId,
  })
}

const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '←'] as const
</script>

<template>
  <AppModal
    title="Cobrar venta"
    :width="560"
    :dismissible="!submitting && step === 'form'"
    @close="emit('close')"
  >
    <!-- PASO 1: método + monto -->
    <div v-if="step === 'form'" class="chk">
      <div class="chk__summary" data-testid="checkout-summary">
        <div class="chk__summary-row">
          <span>{{ cart.itemCount }} artículo(s)</span>
          <span>{{ formatMoney(cart.subtotal) }}</span>
        </div>
        <div class="chk__summary-row chk__summary-row--total">
          <span>Total</span>
          <span>{{ formatMoney(total) }}</span>
        </div>
      </div>

      <div class="chk__methods" role="radiogroup" aria-label="Método de pago">
        <button
          v-for="(label, m) in METHOD_LABELS"
          :key="m"
          type="button"
          class="chk__method"
          :class="{ 'chk__method--selected': method === m }"
          role="radio"
          :aria-checked="method === m"
          @click="method = m as CheckoutMethod; amountText = ''"
        >
          {{ label }}
        </button>
      </div>

      <!-- Dólares sin tasa: banner bloqueante (réplica L601-613). -->
      <AppBanner v-if="dollarRateProblem" type="warning" data-testid="dollar-rate-warning">
        ⚠️ Precio del dólar no configurado
      </AppBanner>

      <!-- Sin caja en efectivo/dólares: warning NO bloqueante (L616-617). -->
      <AppBanner v-else-if="cashSessionWarning" type="warning" data-testid="cash-session-warning">
        No hay una sesión de caja abierta para el Piso 1.
      </AppBanner>

      <template v-if="needsCapture">
        <div class="chk__amount">
          <label class="chk__amount-label" for="chk-amount">
            {{ method === 'dolares' ? 'Monto en USD' : 'Monto recibido' }}
          </label>
          <div class="chk__amount-display" data-testid="amount-received">
            <template v-if="method === 'dolares'">
              {{ amountText === '' ? '$0.00' : `$${amountText}` }} USD
            </template>
            <template v-else>
              {{ amountText === '' ? '$0.00' : `$${amountText}` }}
            </template>
          </div>
          <!-- Display 'Total: $X MXN ≈ $Y USD' (réplica L203-208 + L616-617). -->
          <div v-if="method === 'dolares'" class="chk__usd-total" data-testid="usd-total">
            Total: ${{ total.toFixed(2) }} MXN ≈ ${{ totalUsdNeeded.toFixed(2) }} USD
          </div>
          <div class="chk__numpad">
            <button
              v-for="key in numpadKeys"
              :key="key"
              type="button"
              class="chk__key"
              @click="pressKey(key)"
            >
              {{ key }}
            </button>
            <button type="button" class="chk__key chk__key--clear" @click="pressKey('C')">
              C
            </button>
            <button
              type="button"
              class="chk__key chk__key--exact"
              @click="amountText = (method === 'dolares' ? totalUsdNeeded : total).toFixed(2)"
            >
              Exacto
            </button>
          </div>
        </div>

        <div class="chk__change" data-testid="change-display" aria-live="polite">
          <span>{{ change > 0 ? 'Cambio' : (method === 'dolares' ? 'Falta (MXN)' : 'Falta') }}</span>
          <span
            class="chk__change-value"
            :class="{ 'chk__change-value--ok': amountReceived != null && change >= 0 && (method !== 'dolares' || amountReceived >= totalUsdNeeded) }"
          >
            {{ formatMoney(method === 'dolares' ? change * rate : change) }}
          </span>
        </div>
      </template>

      <p v-else-if="method === 'transferencia'" class="chk__card-note">
        Pago con QR o transferencia: se registra el total.
      </p>
      <p v-else class="chk__card-note">
        Pago con tarjeta: no se captura monto recibido (se registra el total).
      </p>

      <AppBanner v-if="formError" type="error">{{ formError }}</AppBanner>
      <AppBanner v-if="submitError" type="error">{{ submitError }}</AppBanner>
    </div>

    <!-- PASO 2: confirmación de venta -->
    <div v-else class="chk chk--success" data-testid="sale-success">
      <AppBanner type="success">
        Venta <strong>#{{ saleResult?.dailyOrderNumber }}</strong> registrada
      </AppBanner>
      <dl class="chk__result">
        <div class="chk__result-row">
          <dt>Total cobrado</dt>
          <dd>{{ formatMoney(saleResult?.total ?? total) }}</dd>
        </div>
        <div class="chk__result-row" v-if="method !== 'tarjeta' && method !== 'transferencia'">
          <dt>Cambio</dt>
          <dd data-testid="sale-change">{{ formatMoney(saleResult?.changeAmount ?? change) }}</dd>
        </div>
        <div class="chk__result-row">
          <dt>Folio (sistema)</dt>
          <dd>#{{ saleResult?.id }}</dd>
        </div>
      </dl>
      <!-- Fallback: el navegador bloqueó el diálogo → reintento 1-click. -->
      <button
        type="button"
        class="chk__print"
        data-testid="print-ticket"
        @click="retryPrint"
      >
        Imprimir ticket
      </button>
    </div>

    <template #footer>
      <template v-if="step === 'form'">
        <button
          type="button"
          class="chk__btn chk__btn--ghost"
          :disabled="submitting"
          @click="emit('close')"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="chk__btn chk__btn--primary"
          :disabled="!canConfirm"
          data-testid="confirm-sale"
          @click="confirm"
        >
          {{ submitting ? 'Procesando…' : `Cobrar ${formatMoney(total)}` }}
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="chk__btn chk__btn--primary"
          data-testid="finish-sale"
          @click="finish"
        >
          Nueva orden
        </button>
      </template>
    </template>
  </AppModal>

  <!-- Sin preview tras la venta (réplica): la impresión es silenciosa.
       Si el navegador bloqueó el diálogo, el success muestra el botón
       'Imprimir ticket' que reintenta printSaleTickets directamente. -->
</template>

<style scoped>
.chk {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chk__summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--input-bg);
  border-radius: var(--radius);
}

.chk__summary-row {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.chk__summary-row--total {
  color: var(--text);
  font-weight: 700;
  font-size: 1.15rem;
  border-top: 1px solid var(--border-soft);
  padding-top: 8px;
}

/* 4 métodos en grid 2x2 (réplica de las 4 opciones del diálogo Flutter). */
.chk__methods {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.chk__method {
  padding: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.chk__method:hover {
  border-color: var(--text-faint);
  color: var(--text);
}

.chk__method--selected {
  border-color: var(--primary);
  background: rgba(255, 87, 34, 0.12);
  color: var(--primary);
}

.chk__amount {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chk__amount-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.chk__amount-display {
  padding: 12px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text);
  text-align: right;
  min-height: 24px;
}

/* 'Total: $X MXN ≈ $Y USD' (azul info como el banner de DOLARES del Flutter). */
.chk__usd-total {
  padding: 8px 14px;
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid var(--info);
  border-radius: var(--radius);
  color: var(--info);
  font-size: 0.9rem;
  font-weight: 600;
  text-align: center;
}

.chk__numpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.chk__key {
  padding: 14px 0;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 1.05rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.1s ease;
}

.chk__key:hover {
  background: var(--border-soft);
}

.chk__key--clear {
  color: var(--error);
}

.chk__key--exact {
  color: var(--info);
  font-size: 0.85rem;
}

.chk__change {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--input-bg);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 1rem;
}

.chk__change-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-faint);
}

.chk__change-value--ok {
  color: var(--success);
}

.chk__card-note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.chk--success {
  align-items: stretch;
}

.chk__result {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chk__result-row {
  display: flex;
  justify-content: space-between;
}

.chk__result-row dt {
  color: var(--text-muted);
}

.chk__result-row dd {
  margin: 0;
  color: var(--text);
  font-weight: 700;
}

/* Fase 3c: impresión habilitada (estilo previo, cursor activo). */
.chk__print {
  padding: 12px;
  background: transparent;
  border: 1px dashed var(--primary);
  border-radius: var(--radius);
  color: var(--primary);
  font-family: var(--font);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.chk__print:hover {
  background: rgba(255, 87, 34, 0.08);
}

.chk__btn {
  padding: 14px 22px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.chk__btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.chk__btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.chk__btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chk__btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.chk__btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}
</style>
