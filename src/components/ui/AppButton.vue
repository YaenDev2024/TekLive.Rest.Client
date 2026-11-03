<script setup lang="ts">
/**
 * AppButton · botón base del design system CrazyWings.
 * Equivalente a ElevatedButton (main.dart): deepOrange bg, texto blanco,
 * padding 16/24, radius 12, fontSize 16 bold.
 */
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'ghost' | 'danger' | 'success'
  type?: 'button' | 'submit'
  disabled?: boolean
  loading?: boolean
  block?: boolean
  /** Nombre de un icono lucide-vue-next pasado como componente vía slot. */
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  type: 'button',
  disabled: false,
  loading: false,
  block: true,
})

const classes = computed(() => [
  'app-btn',
  `app-btn--${props.variant}`,
  { 'app-btn--block': props.block },
])

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
  >
    <AppSpinner v-if="loading" :size="18" class="app-btn__spinner" />
    <slot v-else name="icon" />
    <span v-if="$slots.default" class="app-btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.app-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 16px 24px;
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.05s ease;
}

.app-btn--block {
  width: 100%;
}

.app-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.app-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* primary: ElevatedButton deepOrange / texto blanco */
.app-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.app-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

/* ghost: transparente + borde grey[700] */
.app-btn--ghost {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}

.app-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
  background: var(--card-overlay);
}

/* danger: redAccent (SnackBar de errores del login Flutter) */
.app-btn--danger {
  background: var(--error);
  color: #ffffff;
}

.app-btn--danger:hover:not(:disabled) {
  background: #ff6b6b;
}

/* success: green (cobrado / confirmaciones) */
.app-btn--success {
  background: var(--success);
  color: #ffffff;
}

.app-btn--success:hover:not(:disabled) {
  background: #5cbf60;
}

.app-btn__spinner {
  flex: none;
}

.app-btn__label {
  display: inline-flex;
  align-items: center;
}
</style>
