<script setup lang="ts">
/**
 * AppModal · modal base del POS (overlay + card centrada, Esc y click fuera
 * cierran cuando la tarea es cancelable). Desktop-first (POS de caja).
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { X } from 'lucide-vue-next'

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
          <X :size="18" aria-hidden="true" />
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
  background: var(--elevated);
  backdrop-filter: blur(2px);
  animation: modal-fade var(--dur) var(--ease);
}

.app-modal__card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: calc(100vh - 48px);
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  animation: modal-in var(--dur) var(--ease);
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
  font-size: var(--text-h2);
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
}

.app-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.app-modal__close:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.07);
}

.app-modal__close:active {
  background: rgba(255, 255, 255, 0.1);
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

@keyframes modal-fade {
  from {
    opacity: 0;
  }
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}

/* Móvil: modal casi full-screen (usable con teclado en pantalla). */
@media (max-width: 599px) {
  .app-modal {
    padding: 12px;
    align-items: flex-end;
  }

  .app-modal__card {
    max-height: calc(100vh - 24px);
    border-radius: var(--radius-lg);
  }

  .app-modal__header {
    padding: 14px 16px;
  }

  .app-modal__body {
    padding: 16px;
  }

  .app-modal__footer {
    padding: 14px 16px;
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }
}
</style>
