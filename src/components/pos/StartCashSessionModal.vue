<script setup lang="ts">
/**
 * StartCashSessionModal · modal de "Iniciar caja" — réplica EXACTA del
 * showDialog de module_selection_screen.dart L113-168 (CrazyWings):
 *
 * - Título 'Iniciar caja - Piso #N' (prop `title` opcional, el original
 *   usa 'Iniciar caja - Planta 2' para Cuentas por Cobrar).
 * - Input Monto con prefijo 'MXN ' (L131) — inputmode decimal: el teclado
 *   virtual global (AutoKeyboardWrapper + stores/keyboard.ts) lo abre
 *   automáticamente al enfocar (NO marcar data-vk-ignore).
 * - Validación double.tryParse >= 0 → snackbar/toast 'Monto inválido' (L141-147).
 * - barrierDismissible = false (L122): NO cierra con Esc ni clic fuera —
 *   AppModal :dismissible="false" y SIN botón X (AppModal lo omite solo si
 *   dismissible=false; aquí además ignoramos el evento close por seguridad).
 * - Botones Cancelar / Iniciar (L135-161).
 *
 * Emite:
 * - `started` tras abrir la sesión OK (el padre navega).
 * - `closed` al Cancelar (el padre NO navega).
 *
 * El estilo visual sigue el diálogo ya-réplica de CashDrawerView.vue
 * (dlg-label / dlg-input-wrap / dlg-prefix / cash-dlg-btn).
 */
import { ref } from 'vue'
import AppModal from './AppModal.vue'
import { useCashStore } from '../../stores/cash'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'

const props = withDefaults(
  defineProps<{
    /** Piso cuya caja se inicia (plantId real del backend). */
    floorId: number
    /** Título custom (el original manda 'Iniciar caja - Planta 2'). */
    title?: string
  }>(),
  { title: undefined },
)

const emit = defineEmits<{ started: []; closed: [] }>()

const cashStore = useCashStore()
const toast = useToastStore()

const amountText = ref('')
const starting = ref(false)

/** Validación réplica L141-147: double.tryParse >= 0, si no → 'Monto inválido'. */
async function start(): Promise<void> {
  const amount = Number.parseFloat(amountText.value.replaceAll(',', '.'))
  if (!Number.isFinite(amount) || amount < 0) {
    toast.warning('Monto inválido')
    return
  }
  if (starting.value) return
  starting.value = true
  try {
    await cashStore.openSession(amount, props.floorId)
    emit('started')
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? err.message
        : 'No se pudo iniciar la caja. Verifica tu conexión.',
    )
  } finally {
    starting.value = false
  }
}

/** Cancelar (L135-137): cierra sin iniciar — el padre NO navega. */
function cancel(): void {
  emit('closed')
}
</script>

<template>
  <!-- barrierDismissible=false (L122): ni Esc ni clic fuera cierran. -->
  <AppModal
    :title="title ?? `Iniciar caja - Piso #${floorId}`"
    :width="420"
    :dismissible="false"
    @close="() => {}"
  >
    <div class="dlg">
      <label class="dlg-label" for="start-session-amount">Monto inicial</label>
      <div class="dlg-input-wrap">
        <span class="dlg-prefix">MXN </span>
        <input
          id="start-session-amount"
          v-model="amountText"
          type="text"
          inputmode="decimal"
          class="dlg-input"
          placeholder="Ej: 500.00"
          data-testid="start-session-amount"
          :disabled="starting"
          @keydown.enter="start"
        />
      </div>
    </div>
    <template #footer>
      <button
        type="button"
        class="cash-dlg-btn cash-dlg-btn--ghost"
        data-testid="start-session-cancel"
        :disabled="starting"
        @click="cancel"
      >
        Cancelar
      </button>
      <button
        type="button"
        class="cash-dlg-btn cash-dlg-btn--primary"
        data-testid="start-session-confirm"
        :disabled="starting"
        @click="start"
      >
        Iniciar
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* Mismos patrones que el diálogo réplica de CashDrawerView.vue (L1239-1337). */
.dlg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dlg-label {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.dlg-input-wrap {
  position: relative;
}

.dlg-prefix {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.dlg-input {
  width: 100%;
  height: 44px;
  padding: 0 12px 0 46px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
}

.dlg-input:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

.dlg-input:disabled {
  opacity: 0.5;
}

.cash-dlg-btn {
  padding: 10px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.cash-dlg-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.cash-dlg-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.cash-dlg-btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cash-dlg-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.cash-dlg-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.cash-dlg-btn--ghost:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
