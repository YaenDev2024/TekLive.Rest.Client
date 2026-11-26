<script setup lang="ts">
/**
 * UpdateIndicator · tarjeta flotante del auto-update.
 *
 * Sólo pinta algo cuando hay algo que contar: descarga en curso, versión lista
 * o instalación en curso. En Web queda invisible.
 *
 * Es fija y global (montada en App.vue) por dos motivos:
 * - El rail desktop mide 80px: una tarjeta ahí dentro no cabe legible.
 * - En APK el aviso debe verse sin importar la vista activa, y el auto-show del
 *   modal queda pausado mientras el cajero está vendiendo en el piso 1 (esa
 *   pantalla es la que más pega). Esta tarjeta es entonces el único aviso.
 */
import { computed } from 'vue'
import { CheckCircle2, Download, RefreshCw } from 'lucide-vue-next'
import {
  installAnyUpdate,
  openUpdateDetails,
  updateView as state,
  updateViewBusy,
} from '../../services/update-ui'

const visible = computed(() => state.value.stage !== 'idle')
const installing = computed(() => state.value.stage === 'installing')
const busy = computed(() => updateViewBusy.value)

const versionLabel = computed(() => (state.value.version ? `v${state.value.version}` : ''))

const subtitle = computed(() => {
  switch (state.value.stage) {
    case 'downloading':
      return `Descargando ${state.value.progress}%`
    case 'ready':
      return state.value.installable ? 'Lista para instalar' : 'No compatible'
    case 'installing':
      return 'La app se reiniciará'
    default:
      return ''
  }
})

async function onInstall(): Promise<void> {
  try {
    await installAnyUpdate()
  } catch {
    // El error queda en el estado; el modal lo muestra.
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="upd"
    :class="{ 'upd--ready': state.stage === 'ready' && state.installable }"
    data-testid="update-indicator"
  >
    <template v-if="state.stage === 'downloading'">
      <div class="upd-head">
        <span class="upd-ico upd-ico--spin">
          <RefreshCw :size="15" aria-hidden="true" />
        </span>
        <div class="upd-txt">
          <b>Actualizando</b>
          <small>{{ subtitle }}</small>
        </div>
      </div>
      <div
        class="upd-bar"
        role="progressbar"
        :aria-valuenow="state.progress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: state.progress + '%' }" />
      </div>
    </template>

    <template v-else-if="state.stage === 'ready'">
      <button
        type="button"
        class="upd-body"
        data-testid="update-open"
        :aria-label="`Actualización ${versionLabel}. Abrir detalle.`"
        @click="openUpdateDetails"
      >
        <span class="upd-ico" :class="state.installable ? 'upd-ico--ok' : 'upd-ico--warn'">
          <CheckCircle2 v-if="state.installable" :size="15" aria-hidden="true" />
          <Download v-else :size="15" aria-hidden="true" />
        </span>
        <span class="upd-txt">
          <b>{{ versionLabel }}</b>
          <small>{{ subtitle }}</small>
        </span>
      </button>
      <button
        v-if="state.installable"
        type="button"
        class="upd-btn"
        data-testid="update-install"
        :disabled="busy || installing"
        @click="onInstall"
      >
        {{ busy ? 'Comprobando…' : 'Actualizar' }}
      </button>
    </template>

    <template v-else-if="installing">
      <div class="upd-head">
        <span class="upd-ico upd-ico--spin">
          <RefreshCw :size="15" aria-hidden="true" />
        </span>
        <div class="upd-txt">
          <b>Instalando…</b>
          <small>{{ subtitle }}</small>
        </div>
      </div>
      <div class="upd-bar upd-bar--indeterminate" role="progressbar">
        <span />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Flotante abajo a la derecha en desktop. En móvil se pega a los lados y sube
   por encima del bottom nav (64px + safe-area del PosShellView). */
.upd {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  width: 264px;
  max-width: calc(100vw - 24px);
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-lg);
}

@media (max-width: 699px) {
  .upd {
    left: 12px;
    right: 12px;
    bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 12px);
    width: auto;
    max-width: none;
  }
}

.upd--ready {
  border-color: var(--primary);
  box-shadow: var(--shadow-accent);
}

.upd-body {
  display: flex;
  align-items: center;
  gap: 9px;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  color: inherit;
  -webkit-tap-highlight-color: transparent;
}

.upd-body:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

.upd-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.upd-ico {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--primary-soft);
  color: var(--primary);
}

.upd-ico--ok {
  background: var(--success-soft);
  color: var(--success);
}

.upd-ico--warn {
  background: var(--error-soft);
  color: var(--error);
}

.upd-ico--spin {
  animation: upd-spin 1.1s linear infinite;
}

@keyframes upd-spin {
  to {
    transform: rotate(360deg);
  }
}

.upd-txt {
  flex: 1;
  min-width: 0;
}

.upd-txt b {
  display: block;
  font-size: 13px;
  line-height: 1.2;
  color: var(--text-1);
  font-weight: 600;
}

.upd-txt small {
  display: block;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 1px;
}

.upd-bar {
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--bg);
  overflow: hidden;
}

.upd-bar span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--primary), var(--primary-hover));
  transition: width var(--dur) var(--ease);
}

.upd-bar--indeterminate span {
  width: 40%;
  animation: upd-slide 1.2s ease-in-out infinite;
}

@keyframes upd-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

.upd-btn {
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: var(--on-primary);
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font);
  padding: 7px 10px;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.upd-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.upd-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.upd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
