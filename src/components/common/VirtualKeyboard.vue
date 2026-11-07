<script setup lang="ts">
/**
 * VirtualKeyboard · teclado virtual PROPIO de la app (réplica EXACTA del
 * overlay de keyboard_provider.dart L90-560 de CrazyWings).
 *
 * Se monta UNA vez en App.vue (position:fixed bottom, z sobre todo). El
 * teclado nativo del SO se suprime en el wrapper global (readonly en
 * pointer coarse + blur → re-focus visual) — este componente SOLO dibuja.
 *
 * Layout NUMÉRICO (réplica _NumericKeyboard L438-560):
 *   Grid 3 columnas '7 8 9 / 4 5 6 / 1 2 3 / 0 . ←', width 280px,
 *   aspect 1.4, teclas grey[800], backspace grey[700], texto 22px.
 *
 * Layout COMPLETO (réplica _FullKeyboard L212-436):
 *   4 filas: 1234567890 / qwertyuiop / asdfghjklñ / zxcvbnm,.-,
 *   shift (flex2) + Espacio (flex4) + backspace (flex2); shift muestra
 *   !@#$%... y mayúsculas; CAPS lo fija. Teclas 45px, grey[800],
 *   especiales grey[700], activas deepOrangeAccent.
 *
 * Header (L157-209): 'Teclado Numérico'/'Teclado' + icono dialpad/keyboard,
 * botón keyboard_hide para cerrar, fondo grey[850], borde grey[800].
 * Contenedor: grey[900], radius top 16, borde top deepOrange 30% (L115-132).
 */
import { computed, ref } from 'vue'
import { ArrowUp, Delete, Keyboard as KeyboardIcon, Grid3x3, ChevronDown } from 'lucide-vue-next'
import { useKeyboardStore } from '../../stores/keyboard'

const kb = useKeyboardStore()

// --- Estado shift/caps (réplica L226-227 + toggle L319-329) -------------------
const shiftPressed = ref(false)
const capsLock = ref(false)

const isNumeric = computed(() => kb.layout === 'numeric')

/** Teclas del layout completo según shift/caps (réplica L229-241, L302). */
const NORMAL_KEYS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
] as const

const SHIFT_KEYS = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '<', '>', '_'],
] as const

const keys = computed(() =>
  shiftPressed.value || capsLock.value ? SHIFT_KEYS : NORMAL_KEYS,
)

const NUMERIC_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '←'] as const

// --- Acciones (réplica _onKeyPressed/_onBackspace/toggles) --------------------

function pressKey(key: string): void {
  kb.insertText(key)
  // Shift se consume tras 1 tecla salvo CAPS (L265-267).
  if (shiftPressed.value && !capsLock.value) shiftPressed.value = false
}

function pressBackspace(): void {
  kb.backspace()
}

function toggleShift(): void {
  if (shiftPressed.value) {
    capsLock.value = true
    shiftPressed.value = false
  } else {
    shiftPressed.value = true
    capsLock.value = false
  }
}

function close(): void {
  // release() del store: restaura el inputmode original (numeric/decimal)
  // y hace blur — réplica hideKeyboard L63-75 + TextInput.hide.
  kb.release()
  shiftPressed.value = false
  capsLock.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="vk-slide">
      <div
        v-if="kb.visible"
        class="vk"
        data-testid="virtual-keyboard"
        @pointerdown.stop
      >
        <!-- Header (réplica _buildHeader L157-209) -->
        <header class="vk__header">
          <span class="vk__header-title">
            <Grid3x3 v-if="isNumeric" :size="18" class="vk__header-icon" aria-hidden="true" />
            <KeyboardIcon v-else :size="18" class="vk__header-icon" aria-hidden="true" />
            {{ isNumeric ? 'Teclado Numérico' : 'Teclado' }}
          </span>
          <button type="button" class="vk__close" aria-label="Cerrar teclado" @click="close">
            <ChevronDown :size="20" aria-hidden="true" />
          </button>
        </header>

        <!-- Numérico (réplica _NumericKeyboard: grid 3x4, width 280) -->
        <div v-if="isNumeric" class="vk__body vk__body--numeric">
          <div class="vk__grid">
            <button
              v-for="key in NUMERIC_KEYS"
              :key="key"
              type="button"
              class="vk__key"
              :class="{ 'vk__key--bs': key === '←' }"
              @click="key === '←' ? pressBackspace() : pressKey(key)"
            >
              <Delete v-if="key === '←'" :size="22" aria-hidden="true" />
              <template v-else>{{ key }}</template>
            </button>
          </div>
        </div>

        <!-- Completo (réplica _FullKeyboard: 4 filas + shift/espacio/bs) -->
        <div v-else class="vk__body">
          <div v-for="(row, ri) in keys" :key="ri" class="vk__row">
            <button
              v-for="key in row"
              :key="key"
              type="button"
              class="vk__key vk__key--full"
              @click="pressKey(key)"
            >
              {{ key }}
            </button>
          </div>
          <div class="vk__row">
            <button
              type="button"
              class="vk__key vk__key--special vk__key--flex2"
              :class="{ 'vk__key--active': shiftPressed || capsLock }"
              @click="toggleShift"
            >
              <ArrowUp :size="18" aria-hidden="true" />
              {{ capsLock ? 'CAPS' : 'Shift' }}
            </button>
            <button
              type="button"
              class="vk__key vk__key--special vk__key--flex4"
              @click="pressKey(' ')"
            >
              Espacio
            </button>
            <button
              type="button"
              class="vk__key vk__key--special vk__key--flex2"
              @click="pressBackspace"
            >
              <Delete :size="18" aria-hidden="true" />
              ←
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Contenedor (réplica L108-132): fixed bottom, grey[900], radius top 16,
   border-top deepOrange 30%, sombra hacia arriba. */
.vk {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background: #212121; /* grey[900] */
  border-radius: 16px 16px 0 0;
  border-top: 2px solid rgba(255, 87, 34, 0.3); /* deepOrangeAccent .3 */
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
  padding: 0 12px 12px;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

/* Header (réplica L157-209): grey[850], borde grey[800], título 13 w600. */
.vk__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  margin: 0 -12px 8px;
  background: #303030; /* grey[850] */
  border-bottom: 1px solid #424242; /* grey[800] */
  border-radius: 14px 14px 0 0;
}

.vk__header-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
}

.vk__header-icon {
  color: #ff5722; /* deepOrangeAccent */
}

.vk__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 20px;
  background: transparent;
  color: #bdbdbd; /* grey[400] */
  cursor: pointer;
}

.vk__close:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* --- Numérico: grid 3 col, width 280, aspect 1.4 (réplica L510-520) --------- */
.vk__body--numeric {
  display: flex;
  justify-content: center;
}

.vk__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: 280px;
}

.vk__grid .vk__key {
  aspect-ratio: 1.4;
  height: auto;
  font-size: 22px;
}

/* --- Completo: filas centradas (réplica L306-312) --------------------------- */
.vk__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 720px;
  margin: 0 auto;
}

.vk__row {
  display: flex;
  gap: 4px;
}

/* Teclas (réplica _buildKey L350-387): 45px alto, grey[800], borde
   grey[700], radius 8, texto blanco 17px w500; hover grey[700]. */
.vk__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 45px;
  border: 1px solid #616161; /* grey[700] */
  border-radius: 8px;
  background: #424242; /* grey[800] */
  color: #ffffff;
  font-size: 17px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  flex: 1;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.vk__key:hover {
  background: #616161; /* hoverColor grey[700] */
}

.vk__key:active {
  background: rgba(255, 87, 34, 0.3); /* splash deepOrange .3 */
}

.vk__key--bs {
  background: #616161; /* backspace grey[700] (L525) */
  border-color: #757575;
}

.vk__key--bs:hover {
  background: #757575;
}

/* Especiales (réplica _buildSpecialKey L389-435): grey[700] base;
   activas deepOrangeAccent con borde deepOrange[300]. */
.vk__key--special {
  background: #616161; /* grey[700] */
  border-color: #757575;
  font-size: 15px;
}

.vk__key--special:hover {
  background: #757575;
}

.vk__key--active {
  background: #ff5722; /* deepOrangeAccent */
  border-color: #ffccae; /* deepOrange[300] */
}

.vk__key--active:hover {
  background: #ff6a3c;
}

.vk__key--flex2 {
  flex: 2;
}

.vk__key--flex4 {
  flex: 4;
}

/* Transición de entrada (slide desde abajo). */
.vk-slide-enter-active,
.vk-slide-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.vk-slide-enter-from,
.vk-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
