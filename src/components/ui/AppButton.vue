<script setup lang="ts">
/**
 * AppButton · botón base del design system CrazzyWings.
 * Equivalente a ElevatedButton (main.dart): deepOrange bg, texto blanco,
 * padding 16/24, radius 12, fontSize 16 bold.
 */
import { computed } from 'vue'
import AppSpinner from './AppSpinner.vue'

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
  padding: 12px 20px;
  font-family: var(--font);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.app-btn--block {
  width: 100%;
}

.app-btn:active:not(:disabled) {
  transform: scale(0.985);
}

.app-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* primary: acción principal — naranja sólido con sombra de acento sutil */
.app-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.app-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: var(--shadow-accent);
}

/* ghost: superficie neutra con borde discreto (acción secundaria) */
.app-btn--ghost {
  background: var(--card);
  color: var(--text-2);
  border-color: var(--border);
}

.app-btn--ghost:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

/* danger: destructivo */
.app-btn--danger {
  background: var(--error);
  color: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.app-btn--danger:hover:not(:disabled) {
  background: #ff6b70;
}

/* success: confirmaciones / cobro */
.app-btn--success {
  background: var(--success);
  color: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.app-btn--success:hover:not(:disabled) {
  background: #4ac45c;
}

.app-btn__spinner {
  flex: none;
}

.app-btn__label {
  display: inline-flex;
  align-items: center;
}
</style>
