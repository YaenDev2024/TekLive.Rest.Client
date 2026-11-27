<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import ToastHost from './components/pos/ToastHost.vue'
import AutoKeyboardWrapper from './components/common/AutoKeyboardWrapper.vue'
import UpdateModal from './components/update/UpdateModal.vue'
import UpdateIndicator from './components/update/UpdateIndicator.vue'
import { preloadTicketLogo } from './services/ticket'
import { startAnyUpdateWatcher } from './services/update-ui'
import { session } from './services/auth'
import { logoCacheVersion, setFavicon } from './services/company-logo'
import { applyCompanyWindowIcon, resetWindowIcon } from './services/window-icon'

onMounted(() => {
  // Ronda logo térmica: decodifica el PNG a raster GS v 0 al arrancar para que
  // la PRIMERA impresión del día ya salga con el logo (el encode es async y el
  // renderer es síncrono: sin preload, el primer ticket saldría sin logo).
  preloadTicketLogo()

  // Auto-update (desktop Tauri / APK Capacitor). Idempotente y no-op en web:
  // nunca lanza ni retrasa el render. La llamada es sin await a propósito.
  startAnyUpdateWatcher()

  syncCompanyLogo()
})

/**
 * Logo de empresa en TODAS las plataformas.
 *
 * El `companyId` viene del servidor (login/me). Con él:
 * - web y APK: el favicon de la pestaña apunta al logo público.
 * - desktop: además se aplica como ícono de ventana, barra de tareas y accesos
 *   directos del usuario (Rust `set_window_icon`).
 *
 * Reactivo a `companyId` (login/logout) y a `logoCacheVersion` (el usuario
 * acaba de subir un logo nuevo en Ajustes: se repinta al instante).
 */
let logoGeneration = 0

function syncCompanyLogo(): void {
  const companyId = session.companyId
  const version = logoCacheVersion.value
  void version // dependencia reactiva: re-aplicar tras subir el logo
  const generation = ++logoGeneration

  setFavicon(companyId)

  if (companyId == null) {
    void resetWindowIcon(() => generation === logoGeneration)
    return
  }
  void applyCompanyWindowIcon(companyId, () => generation === logoGeneration)
}

watch(() => session.companyId, syncCompanyLogo)
watch(logoCacheVersion, syncCompanyLogo)
</script>

<template>
  <AutoKeyboardWrapper>
    <RouterView />
    <ToastHost />
    <!-- Globales: el aviso debe existir en login, selector de módulos y POS. -->
    <UpdateIndicator />
    <UpdateModal />
  </AutoKeyboardWrapper>
</template>
