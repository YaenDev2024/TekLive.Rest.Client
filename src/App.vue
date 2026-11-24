<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastHost from './components/pos/ToastHost.vue'
import AutoKeyboardWrapper from './components/common/AutoKeyboardWrapper.vue'
import { preloadTicketLogo } from './services/ticket'

// Ronda logo térmica: decodifica el PNG a raster GS v 0 al arrancar para que
// la PRIMERA impresión del día ya salga con el logo (el encode es async y el
// renderer es síncrono: sin preload, el primer ticket saldría sin logo).
onMounted(() => {
  preloadTicketLogo()
})
</script>

<template>
  <AutoKeyboardWrapper>
    <RouterView />
    <ToastHost />
  </AutoKeyboardWrapper>
</template>
