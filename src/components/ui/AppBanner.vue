<script setup lang="ts">
/**
 * AppBanner · banner de feedback del design system CrazzyWings.
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
  gap: 10px;
  padding: 11px 13px;
  border-radius: var(--radius);
  font-size: var(--text-sm);
  line-height: 1.45;
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
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 45%, transparent);
  color: #ff8b8f;
}

.app-banner--success {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
  color: #6ede7c;
}

.app-banner--info {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info) 45%, transparent);
  color: #85bdff;
}

.app-banner--warning {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
  color: #f0bf4a;
}
</style>
