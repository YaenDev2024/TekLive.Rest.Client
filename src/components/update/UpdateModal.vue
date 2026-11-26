<script setup lang="ts">
/**
 * UpdateModal · detalle de la actualización disponible (desktop y Android).
 *
 * A diferencia de Abogados, aquí NO hay cuenta regresiva ni versión
 * "obligatoria": el botón "Más tarde" existe mientras el aplazamiento de 24 h
 * no venza. El modal sólo informa y ofrece la instalación explícita; el guard
 * de carrito (services/update-guard.ts) decide si se puede instalar ahora.
 *
 * En Android hay dos casos extra que este mismo componente resuelve:
 * - `installable === false`: el APK no es compatible (firma distinta, no es más
 *   nuevo). Se informa y NO se ofrece instalar.
 * - `needsPermission === true`: falta autorizar "instalar apps desconocidas".
 *   El botón abre el ajuste del sistema; al volver, el usuario reintenta.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download } from 'lucide-vue-next'
import {
  canDeferUpdate,
  closeUpdateDetails,
  deferAnyUpdate,
  installAnyUpdate,
  isUpdateModalPinnedByUser,
  shouldShowUpdateModal,
  updateView as state,
  updateViewBusy,
} from '../../services/update-ui'

/** Visible cuando la descarga terminó y (a) no está aplazada o (b) se reabrió. */
const visible = computed(() => shouldShowUpdateModal())
const installing = computed(() => state.value.stage === 'installing')
const busy = computed(() => updateViewBusy.value)
const isAndroid = computed(() => state.value.platform === 'Android')

const title = computed(() =>
  state.value.installable ? 'Actualización disponible' : 'Actualización no compatible'
)

const installLabel = computed(() => {
  if (busy.value) return 'Comprobando…'
  if (installing.value) return 'Instalando…'
  return isAndroid.value ? 'Actualizar ahora' : 'Actualizar y reiniciar'
})

const hint = computed(() => {
  if (!state.value.installable) {
    return 'Contacta a soporte si necesitas esta versión.'
  }
  return 'La app se cerrará al instalar. Termina la orden en curso antes.'
})

const cardRef = ref<HTMLElement | null>(null)
/** Elemento que tenía el foco antes de abrir: se restaura al cerrar. */
let previouslyFocused: HTMLElement | null = null

/**
 * Foco al diálogo sólo cuando lo abrió el usuario. En el aviso automático NO se
 * toca el foco: en una caja, robar el foco del escáner de código de barras haría
 * que el siguiente producto se escribiera en el diálogo en vez de en el ticket.
 */
watch(visible, async (open) => {
  if (open) {
    if (!isUpdateModalPinnedByUser()) return
    previouslyFocused = document.activeElement as HTMLElement | null
    await nextTick()
    cardRef.value?.focus()
    return
  }
  previouslyFocused?.focus?.()
  previouslyFocused = null
})

const noteLines = computed(() =>
  state.value.notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
)

async function onInstall(): Promise<void> {
  try {
    await installAnyUpdate()
  } catch {
    // El error queda en el estado y se pinta abajo.
  }
}

function onDefer(): void {
  deferAnyUpdate()
}

/** Cerrar con backdrop equivale a "Más tarde" (nunca instala por accidente). */
function onBackdrop(): void {
  if (installing.value) return
  deferAnyUpdate()
}

/** Esc = Más tarde; no se cierra si está instalando. */
function onKeydown(event: KeyboardEvent): void {
  if (!visible.value) return
  if (event.key === 'Escape' && !installing.value) {
    event.preventDefault()
    deferAnyUpdate()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  closeUpdateDetails()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="updm" @click.self="onBackdrop">
      <div
        ref="cardRef"
        class="updm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="updm-title"
        aria-describedby="updm-sub"
        tabindex="-1"
        data-testid="update-modal"
      >
        <div class="updm-ico">
          <Download :size="26" aria-hidden="true" />
        </div>

        <h2 id="updm-title">{{ title }}</h2>
        <p id="updm-sub" class="updm-sub">
          <template v-if="state.installable">
            La versión <strong>v{{ state.version }}</strong> ya se descargó en segundo plano.
            Puedes seguir vendiendo: no se instalará nada hasta que tú lo confirmes.
          </template>
          <template v-else>
            La versión <strong>v{{ state.version }}</strong> está publicada pero no se puede
            instalar en este dispositivo.
          </template>
        </p>

        <div v-if="noteLines.length > 0" class="updm-notes">
          <p v-for="(line, i) in noteLines" :key="i">{{ line }}</p>
        </div>

        <div v-if="state.error" class="updm-error" role="alert">{{ state.error }}</div>

        <div class="updm-actions">
          <button
            v-if="canDeferUpdate()"
            type="button"
            class="updm-btn updm-btn--ghost"
            :disabled="busy || installing"
            @click="onDefer"
          >
            Más tarde
          </button>
          <!-- Sin permiso del sistema: se abre el ajuste, no se instala. -->
          <button
            v-if="state.installable && state.needsPermission"
            type="button"
            class="updm-btn"
            :disabled="busy || installing"
            @click="onInstall"
          >
            Permitir instalación
          </button>
          <button
            v-else-if="state.installable"
            type="button"
            class="updm-btn"
            :disabled="busy || installing"
            @click="onInstall"
          >
            {{ installLabel }}
          </button>
        </div>

        <p class="updm-hint">{{ hint }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.updm {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.updm-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  background: var(--elevated);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 22px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  box-shadow: var(--shadow-xl);
}

.updm-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.updm-ico {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-soft);
  color: var(--primary);
  margin-bottom: 2px;
}

.updm-card h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.updm-sub {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--text-2);
}

.updm-notes {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 10px 14px;
  text-align: left;
}

.updm-notes p {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-2);
}

.updm-error {
  width: 100%;
  background: var(--error-soft);
  color: var(--error);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
}

.updm-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}

.updm-btn {
  flex: 1;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--primary);
  color: var(--on-primary);
  font-family: var(--font);
  font-size: 0.88rem;
  font-weight: 700;
  padding: 11px 14px;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.updm-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.updm-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.updm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.updm-btn--ghost {
  background: var(--card);
  color: var(--text-2);
  border-color: var(--border);
}

.updm-btn--ghost:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-1);
}

.updm-hint {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--text-3);
}

@media (max-width: 480px) {
  .updm {
    padding: 12px;
  }

  .updm-card {
    padding: 20px 16px 16px;
    max-height: calc(100dvh - 24px);
  }
}
</style>
