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
import { onMounted, onBeforeUnmount, watch } from 'vue'
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

/**
 * ¿Hay un gesto de puntero en curso? El focusin ocurre en mousedown; si en
 * ese momento movemos el layout, el click puede aterrizar en el overlay del
 * modal y cerrarlo (@click.self). Con esta bandera el reveal espera al
 * pointerup.
 */
let pointerDown = false
function onPointerDown(): void {
  pointerDown = true
}
function onPointerUp(): void {
  pointerDown = false
}

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

/** Altura del overlay del teclado (0 si no está montado/visible). */
function keyboardHeight(): number {
  const vk = document.querySelector('.vk')
  return vk instanceof HTMLElement ? Math.round(vk.getBoundingClientRect().height) : 0
}

/** Limpia el relleno temporal que se añade para poder subir el último input. */
function clearTempPadding(): void {
  document.querySelectorAll<HTMLElement>('[data-vk-padding]').forEach((node) => {
    node.style.paddingBottom = ''
    delete node.dataset.vkPadding
  })
}

/**
 * Trae el input enfocado a la zona visible ARRIBA del teclado virtual.
 *
 * El teclado es un overlay `position: fixed; bottom: 0`, asi que no reserva
 * espacio en el flujo: sin esto el input que tocas queda DETRAS del teclado.
 * Sube por la cadena de contenedores con scroll (vistas del shell, modales,
 * documento) el alto justo que falta y, si el contenido ya esta al final,
 * reserva un relleno temporal al final para poder desplazarlo.
 */
function revealAboveKeyboard(el: HTMLElement): void {
  const MARGIN = 16
  const vkH = keyboardHeight()
  if (vkH <= 0) return

  const limit = window.innerHeight - vkH - MARGIN
  let remaining = Math.round(el.getBoundingClientRect().bottom - limit)
  if (remaining <= 0) return

  let node: HTMLElement | null = el.parentElement
  while (remaining > 0 && node != null && node !== document.body) {
    const cs = getComputedStyle(node)
    const scrollable =
      /(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight - node.clientHeight > 1
    if (scrollable) {
      const room = node.scrollHeight - node.clientHeight - node.scrollTop
      if (room > 0) {
        const step = Math.min(room, remaining)
        node.scrollTop += step
        remaining -= step
      }
    }
    node = node.parentElement
  }

  // Aún falta (el contenedor estaba al final del scroll): reservar espacio
  // temporal al final del contenedor con scroll más cercano y re-medir.
  if (remaining > 0) {
    const scroller = findScrollableAncestor(el)
    if (scroller != null) {
      const base = parseFloat(scroller.style.paddingBottom || '0') || 0
      scroller.style.paddingBottom = `${base + remaining + MARGIN}px`
      scroller.dataset.vkPadding = '1'
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
      remaining = Math.round(el.getBoundingClientRect().bottom - limit)
    }
  }

  // Último recurso: el documento (páginas standalone, fuera del shell).
  if (remaining > 0) {
    window.scrollBy({ top: remaining, behavior: 'auto' })
  }
}

/** Contenedor con scroll más cercano al input (o el documento). */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node != null && node !== document.body) {
    const cs = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight - node.clientHeight > 1) {
      return node
    }
    node = node.parentElement
  }
  const doc = document.scrollingElement
  return doc instanceof HTMLElement && doc.scrollHeight - doc.clientHeight > 1 ? doc : null
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

  const reveal = (): void => {
    if (!kb.visible) return
    clearTempPadding()
    revealAboveKeyboard(el)
  }

  // El reveal MUEVE el layout (scroll/relleno). Si eso ocurre entre
  // mousedown y mouseup, el cursor queda sobre otro elemento: el @click.self
  // del overlay de los modales interpreta el click como "fuera" y los cierra.
  // Por eso se difiere hasta que el gesto del puntero termino; el foco por
  // teclado (Tab) no tiene ese problema y basta el doble rAF para que Vue
  // monte el overlay y se pueda medir su altura real.
  if (pointerDown) {
    const run = (): void => {
      window.setTimeout(reveal, 0)
    }
    window.addEventListener('pointerup', run, { once: true })
    window.addEventListener('pointercancel', run, { once: true })
    window.setTimeout(reveal, 400) // red de seguridad si no llega el pointerup
  } else {
    requestAnimationFrame(() => requestAnimationFrame(reveal))
  }
}

/** Escape cierra el teclado virtual (desktop). */
function handleKeydownGlobal(event: KeyboardEvent): void {
  if (event.key === 'Escape' && kb.visible) {
    kb.release()
  }
}

// Al cerrar el teclado (X, Escape o cambio de vista) se quita el relleno
// temporal: nunca debe quedar espacio muerto al final de la vista.
watch(
  () => kb.visible,
  (open) => {
    if (!open) clearTempPadding()
  },
)

onMounted(() => {
  document.addEventListener('focusin', handleFocusIn, true)
  document.addEventListener('keydown', handleKeydownGlobal)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerUp, true)
  // visualViewport resize (teclado nativo en móvil): CTA visibles.
  vv = window.visualViewport ?? null
  vv?.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocusIn, true)
  document.removeEventListener('keydown', handleKeydownGlobal)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('pointerup', onPointerUp, true)
  document.removeEventListener('pointercancel', onPointerUp, true)
  vv?.removeEventListener('resize', onViewportChange)
  vv = null
  clearTempPadding()
})
</script>

<template>
  <slot />
  <VirtualKeyboard />
</template>
