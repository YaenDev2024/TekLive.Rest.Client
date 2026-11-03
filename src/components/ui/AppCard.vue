<script setup lang="ts">
/**
 * AppCard · tarjeta base del design system CrazyWings.
 * Equivalente a Card theme (main.dart): color grey[850] #303030, elevation 2,
 * radius 12. `overlay` añade el tinte rgba(0,0,0,0.2) usado por las cards de
 * módulos (module_selection_screen) y la card de login (rgba(0,0,0,0.2)).
 */
interface Props {
  /** Tinte oscuro rgba(0,0,0,0.2) encima del surface, como en Flutter. */
  overlay?: boolean
}

withDefaults(defineProps<Props>(), {
  overlay: false,
})
</script>

<template>
  <div class="app-card">
    <div v-if="overlay" class="app-card__overlay" aria-hidden="true" />
    <div class="app-card__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-card {
  position: relative;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.app-card__overlay {
  position: absolute;
  inset: 0;
  background: var(--card-overlay);
  pointer-events: none;
}

.app-card__content {
  position: relative;
  z-index: 1;
}
</style>
