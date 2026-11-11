<script setup lang="ts">
/**
 * AutoKeyboardWrapper · wrapper GLOBAL de la app (réplica EXACTA de
 * lib/widgets/common/auto_keyboard_wrapper.dart + main.dart L86 de
 * CrazyWings): detecta cuando CUALQUIER input/textarea recibe foco y abre
 * el teclado virtual propio.
 *
 * Supresión del teclado NATIVO (réplica SystemChannels.textInput.hide del
 * Flutter L23/L54/L63):
 * - TOUCH (pointer coarse): pointerdown en captura hace preventDefault
 *   (el SO nunca ve la intención de editar) + focus PROGRAMÁTICO con el
 *   input readonly durante 1 frame → Android/iOS/Windows-tablet no abren
 *   su teclado. La edición va 100% por VirtualKeyboard.
 * - DESKTOP/mouse: al focusin se fuerza inputmode='none' (el teclado
 *   táctil de Windows no aparece; el teclado físico sigue funcionando
 *   normal con caret real).
 * - Passwords: inputmode none también (sin keyboard custom para no
 *   interferir con gestores; el original SÍ usa el custom, divergencia
 *   menor documentada).
 * - El usuario cierra con la X del teclado (como el original: NO se
 *   cierra solo al perder foco, L72-74) o con Escape.
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { useKeyboardStore } from '../../stores/keyboard'
import VirtualKeyboard from './VirtualKeyboard.vue'

const kb = useKeyboardStore()

/**
 * visualViewport: en phone el navegador puede encoger el viewport cuando el
 * teclado del SO aparece (aunque aquí el teclado es propio, Android WebView/
 * Chrome puede reservar espacio en algunos flujos). Medimos el espacio libre
 * y, si el input activo queda tapado, lo traemos a la vista para que su CTA
 * siga clicable (verificación demo P0: Checkout/StartSession/Catálogo/Login).
 */
let vv: VisualViewport | null = null
function onViewportChange(): void {
  if (vv == null) return
  const freeBottom = window.innerHeight - (vv.height + vv.offsetTop)
  if (freeBottom > 80) {
    // Teclado nativo visible: asegurar que el input activo siga visible.
    kb.activeInput?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

const isCoarse = (): boolean => matchMedia('(pointer: coarse)').matches

function isEditable(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLInputElement) {
    if (target.disabled || target.readOnly) return null
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
 * TOUCH: intercepta el tap ANTES del foco nativo. preventDefault evita el
 * focus del SO (y su teclado); luego enfocamos programáticamente con
 * readonly → el navegador no muestra teclado. Restore en rAF+100ms.
 */
function handlePointerDown(event: PointerEvent): void {
  if (!isCoarse()) return
  const el = isEditable(event.target)
  if (el == null) return
  event.preventDefault()
  const wasReadonly = el.readOnly
  el.readOnly = true
  el.focus({ preventScroll: false })
  requestAnimationFrame(() => {
    el.readOnly = wasReadonly
  })
}

/** MOUSE/TOUCH común: registra el input en el store + abre el overlay. */
function handleFocusIn(event: FocusEvent): void {
  const el = isEditable(event.target)
  if (el == null) return
  if (el.closest('[data-vk-ignore]') != null) return

  kb.show(el, isNumericInput(el) ? 'numeric' : 'text')
  // Suprimir teclado táctil del SO (réplica TextInput.hide).
  el.setAttribute('inputmode', 'none')
}

/** El cierre real es la X del teclado / Escape (réplica L72-74). */
function handleKeydownGlobal(event: KeyboardEvent): void {
  if (event.key === 'Escape' && kb.visible) {
    kb.release()
  }
}onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('focusin', handleFocusIn, true)
  document.addEventListener('keydown', handleKeydownGlobal)
  // visualViewport resize (teclado SO en phone): mantener el input visible.
  vv = window.visualViewport ?? null
  vv?.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handlePointerDown, true)
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
