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
 * v2 (2026-11-11): menú EN EL FLUJO (position:absolute dentro del wrapper),
 * SIN Teleport ni position:fixed. Motivo: en iOS PWA, tras abrir/cerrar el
 * teclado nativo el viewport visual queda desplazado/escalado y un menú
 * fixed-teleportado queda con el hit-area desalineado (el tap caía en el
 * backdrop y solo cerraba). En flujo, hit-area == posición visual por
 * construcción. Cierre: tap fuera (pointerdown en document), Escape.
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
const wrap = ref<HTMLDivElement | null>(null)
/** true = abrir hacia arriba (flip simple por espacio disponible). */
const openUp = ref(false)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

function onDocumentPointerDown(event: PointerEvent): void {
  if (open.value && wrap.value != null && !wrap.value.contains(event.target as Node)) {
    close()
  }
}

function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
    triggerFocus()
  }
}

function triggerFocus(): void {
  wrap.value?.querySelector<HTMLButtonElement>('.aps')?.focus()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onWindowKeydown)
}

function toggle(): void {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  // Flip: si no cabe abajo (menú ~min(opciones*44, 240)px) y arriba sí, arriba.
  const el = wrap.value
  if (el != null) {
    const r = el.getBoundingClientRect()
    const menuH = Math.min(props.options.length * 44 + 12, 240)
    openUp.value = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8
  } else {
    openUp.value = false
  }
  open.value = true
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onWindowKeydown)
}

function pick(opt: AppSelectOption): void {
  emit('update:modelValue', opt.value)
  close()
  triggerFocus()
}

onBeforeUnmount(close)
</script>

<template>
  <div ref="wrap" class="aps-wrap">
    <button
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

    <!-- Menú EN FLUJO (absolute dentro del wrapper): hit-area siempre
         alineado con lo visual — sin Teleport ni fixed (bug iOS PWA). -->
    <div v-if="open" class="aps-menu" :class="{ 'aps-menu--up': openUp }" role="listbox">
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
  </div>
</template>

<style scoped>
.aps-wrap {
  position: relative;
  width: 100%;
}

/* Trigger: mismo look que .mc-input/.ecf__input (44px, fill negro .3,
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
  touch-action: manipulation;
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

/* Menú: dropdownColor grey[850] (#303030), borde, radius 12, sombra —
   réplica visual del dropdown del tema Flutter. Anclado al wrapper. */
.aps-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  background: #303030;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
  -webkit-overflow-scrolling: touch;
}

.aps-menu--up {
  top: auto;
  bottom: calc(100% + 4px);
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
  touch-action: manipulation;
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
