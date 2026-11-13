<script setup lang="ts">
/**
 * TicketPreviewModal · preview + IMPRESIÓN del ticket (Fase 3c).
 *
 * Réplica de _TicketPreviewDialog (order_panel.dart ~1420): muestra el ticket
 * EXACTO que se imprimiría, construido con el ticket service (réplica de
 * _buildEscPosKitchenTicket / _buildEscPosClientTicket del printing_service).
 *
 * Dos variantes (isKitchen del Flutter):
 * - Cocina: 'ORDEN PARA PREPARAR', sin precios por item.
 * - Cliente: fiscales + folio + estado + gracias.
 *
 * El botón 'Imprimir' llama printTicket(doc) (iframe + diálogo del navegador)
 * y registra el print-log (best-effort) si props.orderId existe.
 *
 * NOTA ronda print: la VENTA no abre este modal (impresión silenciosa vía
 * services/ticket/sale-print.ts, réplica del original). Este preview queda
 * para los botones ojito del carrito (réplica _TicketPreviewDialog) y para
 * reimprimir desde Órdenes. Pestañas Cocina/Cliente: el original imprime DOS
 * tickets por venta (kitchen:true + kitchen:false, L641-642).
 */
import { computed, ref } from 'vue'
import { Printer } from 'lucide-vue-next'
import type { CartItem } from '../../stores/cart'
import { buildItemNotes, cartItemUnitPrice } from '../../stores/cart'
import {
  buildKitchenTicket,
  buildClientTicket,
  printTicket,
  renderTicketHtml,
  type TicketDoc,
} from '../../services/ticket'
import { logTicketPrint } from '../../api/rest'
import { useAdminTicketConfigStore } from '../../stores/adminTicketConfig'
import AppModal from './AppModal.vue'

const props = defineProps<{
  items: CartItem[]
  total: number
  orderType: string
  /** Info de repartidor (UBER/DIDI) o cliente serializado (EXTERNO). */
  platformDeliveryInfo?: string
  isKitchen: boolean
  /**
   * Id de la orden YA creada (flujo success del checkout): habilita el
   * print-log. En previews del carrito (orden inexistente) es null.
   */
  orderId?: number | null
  /** Folio real (dailyOrderNumber) si la orden existe; 'PENDIENTE' si no. */
  folio?: string | null
  /**
   * Estado PAGADO del ticket cuando la orden ya se cobró (success del
   * checkout). Ausente → 'PENDIENTE DE PAGO' (previews del carrito).
   */
  paidState?: {
    paymentMethod: string
    amountReceived: number
    changeAmount: number
    dollarRate?: number
  } | null
}>()

const emit = defineEmits<{ close: [] }>()

/**
 * Ronda Piso 1: flags del ticket-config (con defaults si la carga falla —
 * nunca bloquea el preview). Se resuelve UNA vez por mount (best-effort).
 */
const ticketCfg = useAdminTicketConfigStore()
void ticketCfg.load()
const cfg = computed(() => ticketCfg.effectiveConfig)

/**
 * Pestañas Cocina/Cliente (el original imprime ambos por venta): default
 * según isKitchen; el usuario puede alternar para reimprimir.
 */
const activeTab = ref<'kitchen' | 'client'>(props.isKitchen ? 'kitchen' : 'client')

/** Nombre de cliente por tipo (réplica switch order_panel.dart L1410-1426). */
const customerName = computed<string>(() => {
  switch (props.orderType) {
    case 'EXTERNO':
      return props.platformDeliveryInfo?.trim() !== '' && props.platformDeliveryInfo != null
        ? props.platformDeliveryInfo
        : 'CLIENTE EXTERNO'
    case 'UBER/DIDI':
      return props.platformDeliveryInfo?.trim() !== '' && props.platformDeliveryInfo != null
        ? props.platformDeliveryInfo
        : 'UBER/DIDI'
    default:
      return 'CLIENTE LOCAL'
  }
})

const now = new Date()

/** Nota COMBINADA del item (misma construcción que placeOrder/checkout). */
function combinedNotes(item: CartItem): string {
  return buildItemNotes(item)
}

/** Doc según isKitchen (réplica _generatePreview). */
const docCurrent = computed<TicketDoc>(() => {
  if (props.isKitchen) {
    return buildKitchenTicket({
      folio: props.folio ?? 'PENDIENTE',
      orderType: props.orderType,
      cashierName: 'CAJERO',
      customerName: customerName.value,
      platformDeliveryInfo: props.platformDeliveryInfo,
      items: props.items.map((item) => ({
        quantity: item.quantity,
        productName: item.productName,
        notes: combinedNotes(item),
        extras: item.extras.map((e) => e.name),
        complements: item.complement != null ? [item.complement.name] : [],
      })),
      total: props.total,
      createdAt: now,
      showModifiers: cfg.value.showKitchenModifiers,
      showNotes: cfg.value.showKitchenNotes,
    })
  }
  return buildClientTicket({
    folio: props.folio ?? 'PENDIENTE',
    orderType: props.orderType,
    customerName: customerName.value,
    cashierName: 'CAJERO',
    items: props.items.map((item) => ({
      quantity: item.quantity,
      productName: item.productName,
      unitPrice: cartItemUnitPrice(item),
      notes: combinedNotes(item),
      extras: item.extras.map((e) => ({ name: e.name, price: e.price })),
      complements:
        item.complement != null
          ? [{ name: item.complement.name, price: item.complement.price }]
          : [],
    })),
    total: props.total,
    createdAt: now,
    footer: cfg.value.footer,
    showNotes: cfg.value.showClientNotes,
    showPaidModifiers: cfg.value.showClientPaidModifiers,
    showFreeModifiers: cfg.value.showClientFreeModifiers,
    // Success del checkout (venta cobrada) → PAGADO - METODO (L1146-1214);
    // previews del carrito/orden sin pagar → 'PENDIENTE DE PAGO'.
    state: props.paidState
      ? {
          kind: 'paid',
          paymentMethod: props.paidState.paymentMethod,
          amountReceived: props.paidState.amountReceived,
          changeAmount: props.paidState.changeAmount,
          dollarRate: props.paidState.dollarRate,
        }
      : { kind: 'pending' },
  })
})

/** Doc de la pestaña Cocina cuando el modal es Cliente (tabs del checkout). */
const docKitchen = computed<TicketDoc>(() =>
  buildKitchenTicket({
    folio: props.folio ?? 'PENDIENTE',
    orderType: props.orderType,
    cashierName: 'CAJERO',
    customerName: customerName.value,
    platformDeliveryInfo: props.platformDeliveryInfo,
    items: props.items.map((item) => ({
      quantity: item.quantity,
      productName: item.productName,
      notes: combinedNotes(item),
      extras: item.extras.map((e) => e.name),
      complements: item.complement != null ? [item.complement.name] : [],
    })),
    total: props.total,
    createdAt: now,
    showModifiers: cfg.value.showKitchenModifiers,
    showNotes: cfg.value.showKitchenNotes,
  }),
)

/** Doc de la pestaña activa. */
const doc = computed<TicketDoc>(() =>
  activeTab.value === 'kitchen' && !props.isKitchen ? docKitchen.value : docCurrent.value,
)

const paperHtml = computed(() => renderTicketHtml(doc.value))

const printing = ref(false)
const printFailed = ref(false)

/** Imprime el ticket EXACTO del preview + print-log best-effort. */
async function onPrint(): Promise<void> {
  printing.value = true
  printFailed.value = false
  const success = printTicket(doc.value)
  if (!success) printFailed.value = true

  const printType = activeTab.value === 'kitchen' || props.isKitchen ? 'kitchen' : 'client'
  if (props.orderId != null) {
    try {
      await logTicketPrint(props.orderId, {
        printType,
        printerName: 'browser',
        success,
        errorMessage: success ? null : 'print dialog failed',
      })
    } catch {
      // El log NO bloquea la impresión (best-effort).
    }
  }
  printing.value = false
}
</script>

<template>
  <AppModal
    :title="isKitchen ? 'Preview Cocina' : 'Preview Cliente'"
    :width="480"
    @close="emit('close')"
  >
    <!-- Pestañas Cocina/Cliente (el original imprime ambos por venta). -->
    <div v-if="!isKitchen" class="tkp__tabs" role="tablist" aria-label="Tipo de ticket">
      <button
        type="button"
        role="tab"
        class="tkp__tab"
        :class="{ 'tkp__tab--active': activeTab === 'kitchen' }"
        :aria-selected="activeTab === 'kitchen'"
        @click="activeTab = 'kitchen'"
      >
        Cocina
      </button>
      <button
        type="button"
        role="tab"
        class="tkp__tab"
        :class="{ 'tkp__tab--active': activeTab === 'client' }"
        :aria-selected="activeTab === 'client'"
        @click="activeTab = 'client'"
      >
        Cliente
      </button>
    </div>
    <div class="tkp" data-testid="ticket-preview">
      <!-- Vista EXACTA de lo impreso: el HTML del renderer (monospace 48ch) -->
      <iframe
        class="tkp__paper"
        :srcdoc="paperHtml"
        title="Vista previa del ticket"
        sandbox=""
      ></iframe>
      <p v-if="printFailed" class="tkp__error" role="alert">
        No se pudo abrir el diálogo de impresión. Intenta de nuevo.
      </p>
    </div>
    <template #footer>
      <button type="button" class="tkp__btn tkp__btn--ghost" @click="emit('close')">Cerrar</button>
      <button
        type="button"
        class="tkp__btn"
        data-testid="ticket-print"
        :disabled="printing"
        @click="onPrint"
      >
        <Printer :size="16" aria-hidden="true" />
        {{ printing ? 'Imprimiendo…' : 'Imprimir' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.tkp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

/* Papel térmico 80mm: el iframe renderiza el HTML exacto de impresión */
.tkp__paper {
  width: 80mm;
  max-width: 100%;
  height: 420px;
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

/* Pestañas Cocina/Cliente (flujo autoPrint: el original imprime ambos). */
.tkp__tabs {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.tkp__tab {
  padding: 6px 18px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.tkp__tab:hover {
  border-color: var(--primary);
  color: var(--text);
}

.tkp__tab--active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.tkp__error {
  margin: 0;
  color: var(--error);
  font-size: 0.85rem;
}

.tkp__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 22px;
  background: var(--primary);
  border: none;
  border-radius: var(--radius);
  color: var(--on-primary);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
}

.tkp__btn--ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.tkp__btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.tkp__btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.tkp__btn:hover:not(:disabled) {
  background: var(--primary-hover);
}
</style>
