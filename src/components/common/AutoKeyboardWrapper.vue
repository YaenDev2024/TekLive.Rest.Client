<script setup lang="ts">
/**
 * AutoKeyboardWrapper · wrapper GLOBAL de la app (réplica del
 * auto_keyboard_wrapper.dart de CrazyWings para DESKTOP).
 *
 * Estrategia por tipo de puntero (decisión beta iOS 2026-11-11):
 * - MOBILE/TABLET (pointer: coarse): NADA propio — el teclado y los
 *   pickers son los NATIVOS del SO (iOS/Android). Sin preventDefault,
 *   sin inputmode='none', sin teclado virtual: los <select> abren su
 *   picker nativo y los inputs el teclado del sistema. (Fix: los selects
 *   no tomaban la opción tocada y se abrían doble teclado.)
 * - DESKTOP (pointer: fine): teclado virtual propio (réplica EXACTA del
 *   teclado in-app Flutter) al enfocar con mouse; el teclado físico
 *   sigue funcionando normal (caret real); inputmode='none' para que el
 *   teclado táctil de Windows no aparezca.
 *
 * Común: cuando el teclado NATIVO (móvil) encoge visualViewport se
 * añade html.vk-open — los ajustes CSS de CTA/modales se reutilizan —
 * y se trae el input enfocado a la vista.
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { useKeyboardStore } from '../../stores/keyboard'
import VirtualKeyboard from './VirtualKeyboard.vue'

const kb = useKeyboardStore()

/**
 * visualViewport: en móvil el teclado NATIVO encoge el viewport. Medimos
 * el espacio libre y, si hay teclado visible, añadimos html.vk-open (los
 * ajustes CSS de CTA ya escritos para el teclado virtual se reutilizan)
 * y traemos el input enfocado a la vista.
 */
let vv: VisualViewport | null = null
function onViewportChange(): void {
  if (vv == null) return
  const freeBottom = window.innerHeight - (vv.height + vv.offsetTop)
  if (freeBottom > 80) {
    // Teclado nativo visible (móvil): mismos ajustes que vk-open.
    document.documentElement.classList.add('vk-open')
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  } else if (!kb.visible) {
    // Teclado cerrado (y virtual tampoco abierto en desktop): limpiar.
    document.documentElement.classList.remove('vk-open')
  }
}

/** Desktop = puntero fino; móvil/tablet = puntero grueso (nativo). */
const isCoarse = (): boolean => matchMedia('(pointer: coarse)').matches

function isEditable(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLInputElement) {
    if (target.disabled) return null
    const t = target.type
    if (t === 'checkbox' || t === 'radio' || t === 'file' || t === 'button' || t === 'submit' || t === 'range' || t === 'color' || t === 'date') return null
    return target
  }
  if (target instanceof HTMLTextAreaElement) return target
  return null
}

/** ¿Tipo numérico? (réplica isNumeric keyboard_provider L105-106). */
function isNumericInput(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el instanceof HTMLInputElement) {
    const type = el.getAttribute('type') ?? ''
    if (type === 'number') return true
    const mode = el.getAttribute('inputmode')
    if (mode === 'numeric' || mode === 'decimal') return true
  }
  return false
}

/**
 * DESKTOP únicamente: focusin (mouse/teclado físico) registra el input y
 * abre el teclado virtual propio. En móvil NO se registra nada (teclado
 * nativo del SO). El inputmode='none' suprime el teclado táctil de
 * Windows; el físico escribe con caret real.
 */
function handleFocusIn(event: FocusEvent): void {
  if (isCoarse()) return
  const el = isEditable(event.target)
  if (el == null) return
  if (el.closest('[data-vk-ignore]') != null) return

  kb.show(el, isNumericInput(el) ? 'numeric' : 'text')
  // Suprimir teclado táctil del SO (réplica TextInput.hide).
  el.setAttribute('inputmode', 'none')
}

/** Escape cierra el teclado virtual (desktop). */
function handleKeydownGlobal(event: KeyboardEvent): void {
  if (event.key === 'Escape' && kb.visible) {
    kb.release()
  }
}

onMounted(() => {
  document.addEventListener('focusin', handleFocusIn, true)
  document.addEventListener('keydown', handleKeydownGlobal)
  // visualViewport resize (teclado nativo en móvil): CTA visibles.
  vv = window.visualViewport ?? null
  vv?.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocusIn, true)
  document.removeEventListener('keydown', handleKeydownGlobal)
  vv?.removeEventListener('resize', onViewportChange)
  vv = null
})
</script>

<template>
  <slot />
  <VirtualKeyboard />
</template>
