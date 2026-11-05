<script setup lang="ts">
/**
 * CheckoutModal · cobro del carrito (Fase 3b).
 *
 * Réplica de cart_checkout_screen.dart:
 * - Métodos efectivo | tarjeta | ambos.
 * - Monto recibido SOLO para efectivo/ambos (tarjeta → amountReceived = total).
 * - Cambio en vivo = max(0, recibido − total), clamp ≥ 0.
 * - Validación: recibido ≥ total para efectivo/ambos (bloquea confirmar).
 * - Éxito → confirmación "Venta #folio — Cambio: $X" + imprimir (Fase 3c).
 */
import { computed, ref } from 'vue'
import { ApiError } from '../../api/client'
import type { CreatedOrderResponse } from '../../api/pos-types'
import { useCartStore, type CheckoutPaymentMethod } from '../../stores/cart'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { POS_PLANT_ID, POS_SUCURSAL_ID } from '../../stores/catalog'
import { session } from '../../services/auth'
import { AppBanner } from '../ui'
import AppModal from './AppModal.vue'

const emit = defineEmits<{ close: [] }>()

const cart = useCartStore()
const ordersStore = useOrdersStore()
const toast = useToastStore()

type Step = 'form' | 'success'

const step = ref<Step>('form')
const method = ref<CheckoutPaymentMethod>('efectivo')
/** Texto crudo del input numérico ('' = vacío, obliga a capturar). */
const amountText = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)
/** 409 u otro error al crear la orden (mostrado inline, modal abierto). */
const submitError = ref<string | null>(null)

const saleResult = ref<CreatedOrderResponse | null>(null)

const total = computed(() => cart.total)

/** Numpad: agrega dígito/punto al monto recibido (teclado POS). */
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

/** Tarjeta no captura monto: amountReceived = total (regla del dueño). */
const effectiveAmountReceived = computed<number>(() =>
  method.value === 'tarjeta' ? total.value : (amountReceived.value ?? 0),
)

const change = computed<number>(() => {
  if (method.value === 'tarjeta') return 0
  return Math.max(0, (amountReceived.value ?? 0) - total.value)
})

/** Falta monto o es menor al total (solo efectivo/ambos). */
const amountProblem = computed<string | null>(() => {
  if (method.value === 'tarjeta') return null
  if (amountReceived.value == null) return 'Captura el monto con el que paga el cliente.'
  if (amountReceived.value <= 0) return 'El monto debe ser mayor a 0.'
  if (amountReceived.value < total.value) {
    return `El cliente pagó $${amountReceived.value.toFixed(2)} pero el total es $${total.value.toFixed(2)}.`
  }
  return null
})

const canConfirm = computed<boolean>(() => amountProblem.value == null && !submitting.value)

async function confirm(): Promise<void> {
  formError.value = null
  submitError.value = null
  if (amountProblem.value != null) {
    formError.value = amountProblem.value
    return
  }

  submitting.value = true
  try {
    const payment =
      method.value === 'tarjeta'
        ? { method: 'tarjeta' as const, amountReceived: total.value }
        : { method: method.value, amountReceived: effectiveAmountReceived.value }

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
        // cashSessionId: TODO(cash-round-2) — gate de caja abierta.
        payment,
        items: cart.toOrderItems(),
      },
      session.displayName ?? 'Cajero',
    )

    saleResult.value = created
    step.value = 'success'
    cart.clear()
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
          v-for="m in (['efectivo', 'tarjeta', 'ambos'] as const)"
          :key="m"
          type="button"
          class="chk__method"
          :class="{ 'chk__method--selected': method === m }"
          role="radio"
          :aria-checked="method === m"
          @click="method = m"
        >
          {{ m.charAt(0).toUpperCase() + m.slice(1) }}
        </button>
      </div>

      <template v-if="method !== 'tarjeta'">
        <div class="chk__amount">
          <label class="chk__amount-label" for="chk-amount">Monto recibido</label>
          <div class="chk__amount-display" data-testid="amount-received">
            {{ amountText === '' ? '$0.00' : `$${amountText}` }}
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
              @click="amountText = total.toFixed(2)"
            >
              Exacto
            </button>
          </div>
        </div>

        <div class="chk__change" data-testid="change-display" aria-live="polite">
          <span>Cambio</span>
          <span class="chk__change-value" :class="{ 'chk__change-value--ok': amountReceived != null && amountReceived >= total }">
            {{ formatMoney(change) }}
          </span>
        </div>
      </template>

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
        <div class="chk__result-row" v-if="method !== 'tarjeta'">
          <dt>Cambio</dt>
          <dd data-testid="sale-change">{{ formatMoney(saleResult?.changeAmount ?? change) }}</dd>
        </div>
        <div class="chk__result-row">
          <dt>Folio (sistema)</dt>
          <dd>#{{ saleResult?.id }}</dd>
        </div>
      </dl>
      <!-- Fase 3c: impresión de ticket (botón deshabilitado esta ronda). -->
      <button type="button" class="chk__print" disabled title="Disponible en Fase 3c">
        Imprimir ticket (Fase 3c)
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

.chk__methods {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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

.chk__print {
  padding: 12px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-faint);
  font-family: var(--font);
  font-size: 0.9rem;
  cursor: not-allowed;
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
