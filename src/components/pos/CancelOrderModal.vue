<script setup lang="ts">
/**
 * CancelOrderModal · cancelar orden pendiente con nota OBLIGATORIA (Fase 3b).
 * El rol puede no permitir cancelar → maneja 403 mostrando el mensaje.
 */
import { ref } from 'vue'
import { ApiError } from '../../api/client'
import type { OrderStatus, PendingOrderListItem } from '../../api/pos-types'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { AppBanner } from '../ui'
import AppModal from './AppModal.vue'

const props = defineProps<{
  order: PendingOrderListItem
}>()

const emit = defineEmits<{ close: []; cancelled: [] }>()

const ordersStore = useOrdersStore()
const toast = useToastStore()

const notes = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

/** PATCH /status con expectedStatus=actual, newStatus=cancelada, notes obligatoria. */
async function confirmCancel(): Promise<void> {
  if (notes.value.trim().length === 0) {
    error.value = 'La nota de cancelación es obligatoria.'
    return
  }
  submitting.value = true
  error.value = null
  try {
    const result = await ordersStore.advanceOrder(props.order.id, {
      expectedStatus: props.order.orderStatus as OrderStatus,
      newStatus: 'cancelada',
      notes: notes.value.trim(),
    })
    if (result === true) {
      toast.success(`Orden #${props.order.dailyOrderNumber} cancelada`)
      emit('cancelled')
      emit('close')
    } else {
      // 409: alguien cambió el estado antes.
      const conflict = ordersStore.lastConflict
      error.value =
        conflict != null && conflict.currentStatus !== 'not-found'
          ? `La orden ya no está ${props.order.orderStatus}: ahora está "${conflict.currentStatus}". Recargando…`
          : 'No se pudo cancelar: la orden cambió de estado. Recargando…'
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      error.value = err.message !== '' ? err.message : 'Tu rol no permite cancelar órdenes.'
    } else {
      error.value =
        err instanceof ApiError && err.status !== 0
          ? `Error al cancelar: ${err.message}`
          : 'No se pudo conectar con el servidor. Verifica tu conexión.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppModal
    :title="`Cancelar orden #${order.dailyOrderNumber}`"
    :width="460"
    :dismissible="!submitting"
    @close="emit('close')"
  >
    <div class="cxl">
      <AppBanner type="warning">
        Esta acción marca la orden como <strong>cancelada</strong>. Requiere una nota obligatoria.
      </AppBanner>

      <label class="cxl__label" for="cxl-notes">Motivo de cancelación *</label>
      <textarea
        id="cxl-notes"
        v-model="notes"
        class="cxl__textarea"
        rows="3"
        placeholder="Ej. cliente se arrepintió, error de captura…"
      ></textarea>

      <AppBanner v-if="error" type="error">{{ error }}</AppBanner>
    </div>

    <template #footer>
      <button
        type="button"
        class="cxl__btn cxl__btn--ghost"
        :disabled="submitting"
        @click="emit('close')"
      >
        Volver
      </button>
      <button
        type="button"
        class="cxl__btn cxl__btn--danger"
        :disabled="submitting || notes.trim().length === 0"
        data-testid="confirm-cancel"
        @click="confirmCancel"
      >
        {{ submitting ? 'Cancelando…' : 'Cancelar orden' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.cxl {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cxl__label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.cxl__textarea {
  width: 100%;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9rem;
  resize: vertical;
}

.cxl__textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.cxl__btn {
  padding: 12px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.cxl__btn--danger {
  background: var(--error);
  color: #ffffff;
}

.cxl__btn--danger:hover:not(:disabled) {
  background: #ff6b6b;
}

.cxl__btn--danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cxl__btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.cxl__btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}
</style>
