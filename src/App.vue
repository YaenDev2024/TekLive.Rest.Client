<script setup lang="ts">
import { RouterView } from 'vue-router'
import ToastHost from './components/pos/ToastHost.vue'
import AutoKeyboardWrapper from './components/common/AutoKeyboardWrapper.vue'
</script>

<template>
  <AutoKeyboardWrapper>
    <RouterView />
    <ToastHost />
  </AutoKeyboardWrapper>
</template>
