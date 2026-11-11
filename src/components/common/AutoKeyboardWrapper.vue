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
 *   input readonly DURANTE TODA la sesión de edición (iOS 16+ decide abrir
 *   el teclado nativo después del touchend: el toggle en rAF llegaba tarde
 *   y se abrían ambos teclados). El restore lo hace kb.release()/show().
 *   Android/iOS/Windows-tablet no abren su teclado. La edición va 100% por
 *   VirtualKeyboard.
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
    // readOnly NO descalifica: el wrapper pone readonly persistente en touch
    // para suprimir el teclado nativo (iOS 16+) y el focusin posterior debe
    // registrar igualmente el input en el store (kb.insertText escribe vía
    // .value programático, permitido con readonly). disabled sí bloquea.
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
 * TOUCH: intercepta el tap ANTES del foco nativo. preventDefault evita el
 * focus del SO (y su teclado); luego enfocamos programáticamente con
 * readonly → el navegador no muestra teclado.
 *
 * iOS 16+ PWA: el toggle readonly en rAF NO alcanza — iOS decide abrir el
 * teclado en la activación del gesto y, con el input editable de nuevo
 * antes de esa decisión, el teclado NATIVO aparece junto al virtual (bug
 * reportado: "se abren ambos" + saltos de foco tipo "Enter"). El readonly
 * persiste durante TODA la sesión de edición y lo restaura kb.release()
 * (X del teclado) o kb.show() del siguiente input: escribir vía
 * kb.insertText() funciona igual (setear .value programáticamente no está
 * bloqueado por readonly y el evento 'input' se dispara igual).
 */
function handlePointerDown(event: PointerEvent): void {
  if (!isCoarse()) return
  const target = event.target
  // iOS PWA: el tap sobre la <option> del picker nativo burbujea como
  // pointerdown antes del commit; un preventDefault aquí rompe el 'change'
  // y el select vuelve al valor anterior (bug reportado en iPhone). El
  // picker del SO no es DOM: cualquier elemento dentro de un <select> (o el
  // propio select/option/optgroup) debe recibir el gesto SIN interferencia.
  if (
    target instanceof HTMLSelectElement ||
    target instanceof HTMLOptionElement ||
    target instanceof HTMLOptGroupElement ||
    (target instanceof Element && target.closest('select') != null)
  ) {
    return
  }
  const el = isEditable(target)
  if (el == null) return
  event.preventDefault()
  const wasReadonly = el.readOnly
  el.dataset.vkOriginalReadonly = wasReadonly ? '1' : '0'
  el.readOnly = true
  el.focus({ preventScroll: false })
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
