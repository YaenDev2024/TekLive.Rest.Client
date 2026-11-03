<script setup lang="ts">
/**
 * AppSpinner · spinner circular base (CrazyWings CircularProgressIndicator).
 * Color configurable: blanco (sobre botones deepOrange) o primary.
 */
interface Props {
  size?: number
  /** 'light' = blanco (sobre primary/danger), 'primary' = deepOrange. */
  tone?: 'light' | 'primary'
}

withDefaults(defineProps<Props>(), {
  size: 18,
  tone: 'light',
})
</script>

<template>
  <span
    class="app-spinner"
    :class="`app-spinner--${tone}`"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="status"
    aria-label="Cargando"
  />
</template>

<style scoped>
.app-spinner {
  display: inline-block;
  border-radius: 50%;
  animation: app-spin 0.7s linear infinite;
}

.app-spinner--light {
  border: 2px solid rgba(0, 0, 0, 0.25);
  border-top-color: #ffffff;
}

.app-spinner--primary {
  border: 2px solid var(--card-overlay);
  border-top-color: var(--primary);
}

@keyframes app-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
