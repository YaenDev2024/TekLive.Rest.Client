<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastHost from './components/pos/ToastHost.vue'
import AutoKeyboardWrapper from './components/common/AutoKeyboardWrapper.vue'
import UpdateModal from './components/update/UpdateModal.vue'
import UpdateIndicator from './components/update/UpdateIndicator.vue'
import { preloadTicketLogo } from './services/ticket'
import { startAnyUpdateWatcher } from './services/update-ui'

onMounted(() => {
  // Ronda logo térmica: decodifica el PNG a raster GS v 0 al arrancar para que
  // la PRIMERA impresión del día ya salga con el logo (el encode es async y el
  // renderer es síncrono: sin preload, el primer ticket saldría sin logo).
  preloadTicketLogo()

  // Auto-update (desktop Tauri / APK Capacitor). Idempotente y no-op en web:
  // nunca lanza ni retrasa el render. La llamada es sin await a propósito.
  startAnyUpdateWatcher()
})
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
