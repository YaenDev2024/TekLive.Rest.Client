<script setup lang="ts">
/**
 * ToastHost · renderizador global del toast store (mini).
 * Fixed top-center, z sobre modales; colores del design system.
 */
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-vue-next'
import { useToastStore, type ToastKind } from '../../stores/toast'
import { computed } from 'vue'

const toast = useToastStore()

const ICONS: Record<ToastKind, unknown> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const icon = computed(() => ICONS[toast.current?.kind ?? 'info'])
</script>

<template>
  <Transition name="toast">
    <div
      v-if="toast.current"
      :key="toast.current.id"
      class="toast-host"
      :class="`toast-host--${toast.current.kind}`"
      role="status"
      aria-live="polite"
      data-testid="toast"
      @click="toast.dismiss()"
    >
      <component :is="icon" :size="18" aria-hidden="true" />
      <span class="toast-host__text">{{ toast.current.message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 480px;
  padding: 12px 18px;
  border-radius: var(--radius);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.toast-host--success {
  border-color: var(--success);
  color: var(--success);
}

.toast-host--error {
  border-color: var(--error);
  color: var(--error);
}

.toast-host--info {
  border-color: var(--info);
  color: var(--info);
}

.toast-host--warning {
  border-color: var(--warning);
  color: var(--warning);
}

.toast-host__text {
  color: var(--text);
  /* Ronda 3: toasts multilínea del Flutter ('✓ Orden procesada\n💵 Cambio: $X'). */
  white-space: pre-line;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
