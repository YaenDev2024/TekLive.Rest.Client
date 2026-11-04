<script setup lang="ts">
/**
 * AppModal · modal base del POS (overlay + card centrada, Esc y click fuera
 * cierran cuando la tarea es cancelable). Desktop-first (POS de caja).
 */
import { onBeforeUnmount, onMounted } from 'vue'

interface Props {
  title: string
  /** Ancho máximo del card (px). Default 520. */
  width?: number
  /** false = no cierra con Esc/click fuera (p.ej. venta en proceso). */
  dismissible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  width: 520,
  dismissible: true,
})

const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent): void {
  if (props.dismissible && event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="app-modal"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click.self="dismissible && emit('close')"
  >
    <div class="app-modal__card" :style="{ maxWidth: `${width}px` }">
      <header class="app-modal__header">
        <h2 class="app-modal__title">{{ title }}</h2>
        <button
          v-if="dismissible"
          type="button"
          class="app-modal__close"
          aria-label="Cerrar"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <div class="app-modal__body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="app-modal__footer">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.app-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
}

.app-modal__card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: calc(100vh - 48px);
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.app-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-soft);
}

.app-modal__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text);
}

.app-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.app-modal__close:hover {
  color: var(--text);
  background: var(--card-overlay);
}

.app-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.app-modal__footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-soft);
}
</style>
