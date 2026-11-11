<script setup lang="ts">
/**
 * AppSelect · dropdown propio del design system (reemplaza <select> nativo).
 *
 * Por qué existe: el picker NATIVO de <select> en iOS PWA standalone no
 * confirma la opción tocada (bug del wheel picker de WebKit en modo
 * standalone, reproducido en iPhone real 2026-11-11 con selects 100%
 * nativos y sin listeners globales). Este componente usa SOLO botones
 * HTML con @click — el mismo mecanismo de todos los controles que ya
 * funcionan en iOS/Android/desktop.
 *
 * - Trigger = <button> temático (fill oscuro, borde, radius, caret).
 * - Menú = teleport a body, position:fixed anclado al rect del trigger
 *   (sin clipping por overflow de modales), flip arriba si no cabe abajo.
 * - Cierra: tap fuera (backdrop), Escape, scroll del contenedor, resize.
 * - v-model + options [{value,label}], placeholder opcional, testid.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

export interface AppSelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: AppSelectOption[]
    placeholder?: string
    disabled?: boolean
    /** data-testid para E2E (trigger). */
    testid?: string
    ariaLabel?: string
  }>(),
  { placeholder: '', disabled: false, testid: undefined, ariaLabel: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [string | number] }>()

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

function positionMenu(): void {
  const el = trigger.value
  if (el == null) return
  const r = el.getBoundingClientRect()
  const itemH = 44
  const menuH = Math.min(props.options.length * itemH + 16, 280)
  const below = window.innerHeight - r.bottom
  const openUp = below < menuH + 12 && r.top > menuH + 12
  menuStyle.value = openUp
    ? {
        left: `${Math.max(8, r.left)}px`,
        width: `${r.width}px`,
        bottom: `${window.innerHeight - r.top + 4}px`,
        maxHeight: `${Math.min(r.top - 16, 280)}px`,
      }
    : {
        left: `${Math.max(8, r.left)}px`,
        width: `${r.width}px`,
        top: `${r.bottom + 4}px`,
        maxHeight: `${Math.min(below - 16, 280)}px`,
      }
}

function close(): void {
  open.value = false
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', onWindowKeydown)
}

function onScroll(): void {
  close()
}

function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
    trigger.value?.focus()
  }
}

function toggle(): void {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  positionMenu()
  open.value = true
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', onWindowKeydown)
}

function pick(opt: AppSelectOption): void {
  emit('update:modelValue', opt.value)
  close()
  trigger.value?.focus()
}

onBeforeUnmount(close)
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="aps"
    :data-testid="testid"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :aria-expanded="open"
    aria-haspopup="listbox"
    @click="toggle"
  >
    <span class="aps__label" :class="{ 'aps__label--empty': selectedLabel === '' }">
      {{ selectedLabel !== '' ? selectedLabel : placeholder }}
    </span>
    <ChevronDown :size="18" class="aps__caret" :class="{ 'aps__caret--open': open }" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div v-if="open" class="aps-backdrop" @click="close" />
    <div v-if="open" class="aps-menu" :style="menuStyle" role="listbox">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        class="aps-menu__item"
        :class="{ 'aps-menu__item--selected': opt.value === modelValue }"
        role="option"
        :aria-selected="opt.value === modelValue"
        @click="pick(opt)"
      >
        <span class="aps-menu__label">{{ opt.label }}</span>
        <Check v-if="opt.value === modelValue" :size="18" class="aps-menu__check" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* Trigger: mismo look que .mc-input/.mc-select (44px, fill negro .3,
   borde, radius, texto 15px blanco). */
.aps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.aps:disabled {
  opacity: 0.5;
  cursor: default;
}

.aps__label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aps__label--empty {
  color: var(--text-faint);
}

.aps__caret {
  flex: none;
  color: var(--text-faint);
  transition: transform 0.15s ease;
}

.aps__caret--open {
  transform: rotate(180deg);
}

/* Backdrop invisible para cerrar con tap fuera. */
.aps-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9997;
  background: transparent;
}

/* Menú: dropdownColor grey[850] (#303030), borde, radius 12, sombra —
   réplica visual del dropdown del tema Flutter. */
.aps-menu {
  position: fixed;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px;
  background: #303030;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
  -webkit-overflow-scrolling: touch;
}

.aps-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.aps-menu__item:active {
  background: rgba(255, 255, 255, 0.08);
}

.aps-menu__item--selected {
  background: rgba(255, 87, 34, 0.22); /* deepOrange .22 */
  color: #fff;
  font-weight: 600;
}

.aps-menu__label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.aps-menu__check {
  flex: none;
  color: var(--accent, #ff5722);
}
</style>
