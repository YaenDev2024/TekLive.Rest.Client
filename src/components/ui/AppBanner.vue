<script setup lang="ts">
/**
 * AppBanner · banner de feedback del design system CrazyWings.
 * Fondos alpha + borde de color pleno, como payment_screen.dart:
 * error: rgba(255,82,82,0.12) + borde #FF5252 (SnackBar redAccent)
 * success: rgba(76,175,80,0.1) + borde #4CAF50 (banner "COBRADO")
 * info: rgba(33,150,243,0.1) + borde #2196F3
 * warning: rgba(255,152,0,0.1) + borde #FF9800
 */
interface Props {
  type?: 'error' | 'success' | 'info' | 'warning'
}

withDefaults(defineProps<Props>(), {
  type: 'info',
})
</script>

<template>
  <div :class="['app-banner', `app-banner--${type}`]" role="status">
    <span class="app-banner__icon" aria-hidden="true"><slot name="icon" /></span>
    <span class="app-banner__text"><slot /></span>
  </div>
</template>

<style scoped>
.app-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius);
  font-size: 0.9rem;
  border: 1px solid transparent;
}

.app-banner__icon {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-top: 1px;
}

.app-banner__text {
  flex: 1;
}

.app-banner--error {
  background: rgba(255, 82, 82, 0.12);
  border-color: var(--error);
  color: var(--error);
}

.app-banner--success {
  background: rgba(76, 175, 80, 0.1);
  border-color: var(--success);
  color: var(--success);
}

.app-banner--info {
  background: rgba(33, 150, 243, 0.1);
  border-color: var(--info);
  color: var(--info);
}

.app-banner--warning {
  background: rgba(255, 152, 0, 0.1);
  border-color: var(--warning);
  color: var(--warning);
}
</style>
