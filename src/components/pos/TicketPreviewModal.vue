<script setup lang="ts">
/**
 * TicketPreviewModal · preview del ticket en pantalla (ronda 3).
 *
 * Réplica simple de _TicketPreviewDialog (order_panel.dart ~1420): layout de
 * ticket térmico 58mm en monospace con los datos REALES de la orden actual
 * (no ficticios). Solo preview — la impresión ESC/POS real es Fase 3c.
 *
 * Dos variantes (isKitchen del Flutter):
 * - Cocina  (restaurant icon): header COCINA, sin métodos de pago.
 * - Cliente (receipt_long):    header Crazy Wings + folio + gracias.
 */
import { computed } from 'vue'
import type { CartItem } from '../../stores/cart'
import { buildItemNotes, cartItemUnitPrice } from '../../stores/cart'
import AppModal from './AppModal.vue'

const props = defineProps<{
  items: CartItem[]
  total: number
  orderType: string
  /** Info de repartidor (UBER/DIDI) o cliente serializado (EXTERNO). */
  platformDeliveryInfo?: string
  isKitchen: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const WIDTH = 42 // 58mm térmica ≈ 42 chars monospace (réplica lineWidth L1537)

function center(text: string): string {
  const t = text.slice(0, WIDTH)
  const pad = Math.max(0, Math.floor((WIDTH - t.length) / 2))
  return ' '.repeat(pad) + t
}

function row(left: string, right: string): string {
  const space = WIDTH - left.length - right.length
  if (space < 1) return `${left} ${right}`.slice(0, WIDTH)
  return left + ' '.repeat(space) + right
}

/** Nombre de cliente por tipo (réplica switch L1410-1426). */
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

const orderNumber = computed<string>(() =>
  props.orderType === 'UBER/DIDI' ? 'PLATAFORMA' : 'PENDIENTE',
)

const now = new Date()
const fecha = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

/** Líneas del ticket (misma construcción de notas que placeOrder). */
const lines = computed<Array<{ qty: number; name: string; price: string; notes: string[] }>>(
  () =>
    props.items.map((item) => {
      const notes: string[] = []
      const noteRaw = buildItemNotes(item)
      if (noteRaw.trim() !== '') {
        // OPT:: / NOTE:: separados por || → líneas del ticket.
        for (const part of noteRaw.split(' || ')) {
          const trimmed = part.trim()
          if (trimmed === '') continue
          if (trimmed.startsWith('OPT::')) {
            notes.push(...trimmed.slice(5).split(' | ').filter((s) => s !== ''))
          } else if (trimmed.startsWith('NOTE::')) {
            notes.push(...trimmed.slice(6).split(' | ').filter((s) => s !== ''))
          } else {
            notes.push(trimmed)
          }
        }
      }
      return {
        qty: item.quantity,
        name: item.productName,
        price: `$${(cartItemUnitPrice(item) * item.quantity).toFixed(2)}`,
        notes,
      }
    }),
)

const div = '-'.repeat(WIDTH)
</script>

<template>
  <AppModal
    :title="isKitchen ? 'Preview Cocina' : 'Preview Cliente'"
    :width="480"
    @close="emit('close')"
  >
    <div class="tkp" data-testid="ticket-preview">
      <pre class="tkp__paper">{{ `
${center(isKitchen ? '*** COCINA ***' : 'CRAZY WINGS')}
${center(isKitchen ? 'ORDEN: ' + orderNumber : 'Ticket ' + orderNumber)}
${center(fecha)}
${div}
${lines.map(l => [
  row(`${l.qty} x ${l.name}`, l.price),
  ...l.notes.map(n => `   - ${n}`),
].join('\n')).join('\n')}
${div}
${row('TOTAL', `$${total.toFixed(2)}`)}
${isKitchen ? '' : `\n${center('GRACIAS POR SU COMPRA!')}${'\n'}${center(customerName)}`}
` }}</pre>
    </div>
    <template #footer>
      <button type="button" class="tkp__btn" @click="emit('close')">Cerrar</button>
    </template>
  </AppModal>
</template>

<style scoped>
.tkp {
  display: flex;
  justify-content: center;
}

/* Papel térmico 58mm: fondo claro, monospace, ancho fijo */
.tkp__paper {
  margin: 0;
  width: 58mm;
  max-width: 100%;
  padding: 14px 10px;
  background: #f5f2ea;
  color: #1a1a1a;
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
  overflow-x: auto;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.tkp__btn {
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

.tkp__btn:hover {
  background: var(--primary-hover);
}
</style>
