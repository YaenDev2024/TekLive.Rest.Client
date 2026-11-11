/**
 * TekLive Rest — Keyboard store (DESKTOP únicamente).
 *
 * El teclado virtual PROPIO solo existe en desktop (pointer: fine), como
 * réplica del teclado in-app de la app Flutter CrazyWings. En móvil/tablet
 * (pointer: coarse) NO se usa: los inputs abren el teclado NATIVO del SO
 * (iOS/Android) y los <select> el picker nativo (decisión beta iOS
 * 2026-11-11 tras los bugs de doble teclado y selects que no tomaban la
 * opción tocada).
 *
 * Dos layouts como el original:
 * - Numérico (keyboardType number/decimal): grid 3x4 '789/456/123/0.←',
 *   width 280, aspect 1.4, '←' = backspace.
 * - Completo: 4 filas QWERTY con acentos + números arriba, shift/caps,
 *   espacio, backspace.
 *
 * show() registra el input activo; el overlay (VirtualKeyboard.vue,
 * montado en App.vue) escribe vía inserción en el caret.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type KeyboardLayout = 'numeric' | 'full'

export const useKeyboardStore = defineStore('keyboard', () => {
  /** Input HTML activo (escritura directa via value + eventos). */
  const activeInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const layout = ref<KeyboardLayout>('full')
  const visible = ref(false)

  /**
   * Abrir teclado para un input (desktop). type 'numeric' = grid 3x4;
   * 'text' = QWERTY completo.
   */
  function show(
    input: HTMLInputElement | HTMLTextAreaElement,
    type: 'numeric' | 'text' = 'text',
  ): void {
    // Si había OTRO input activo (el foco saltó sin pasar por la X),
    // restaurar su inputmode original para no dejarlo en 'none' residual.
    const prev = activeInput.value
    if (prev != null && prev !== input) {
      const prevOriginal = prev.dataset.vkOriginalInputmode ?? ''
      if (prevOriginal) prev.setAttribute('inputmode', prevOriginal)
      else prev.removeAttribute('inputmode')
      delete prev.dataset.vkOriginalInputmode
    }
    activeInput.value = input
    layout.value = type === 'numeric' ? 'numeric' : 'full'
    visible.value = true
    // Bandera global: los modales suben su CTA cuando el teclado está abierto
    // (verificación P0: CTA clicable con teclado visible a 1280x800 desktop).
    document.documentElement.classList.add('vk-open')
    // Guardar el inputmode original (numeric/decimal/text) para restaurarlo
    // en release() — el 'none' de supresión es temporal, no destructivo.
    if (input.dataset.vkOriginalInputmode === undefined) {
      const original = input.getAttribute('inputmode')
      input.dataset.vkOriginalInputmode = original ?? ''
    }
  }

  /** Cerrar (réplica hideKeyboard L63-75: botón X o Escape). */
  function hide(): void {
    visible.value = false
    activeInput.value = null
    document.documentElement.classList.remove('vk-open')
  }

  /**
   * Restaurar el input al cerrar (X del teclado / Escape): quita el
   * inputmode='none' de supresión del teclado táctil de Windows SIN borrar
   * el inputmode ORIGINAL (numeric/decimal) — sin esto, el siguiente focus
   * abriría el layout equivocado.
   */
  function release(): void {
    const el = activeInput.value
    if (el != null) {
      const original = el.dataset.vkOriginalInputmode ?? ''
      if (original) el.setAttribute('inputmode', original)
      else el.removeAttribute('inputmode')
      delete el.dataset.vkOriginalInputmode
      el.blur()
    }
    hide()
  }

  /**
   * Inserción en el caret (réplica _onKeyPressed: replaceRange + colapsar
   * selección al final del texto insertado). Dispara el evento 'input' para
   * que v-model/onInput reaccionen. Inputs type=number NO soportan
   * selectionStart (DOMException) — fallback: append al final (el teclado
   * numérico es el único que los toca).
   */
  function insertText(text: string): void {
    const input = activeInput.value
    if (input == null) return
    let start: number
    let end: number
    try {
      start = input.selectionStart ?? input.value.length
      end = input.selectionEnd ?? start
    } catch {
      start = input.value.length
      end = start
    }
    input.value = input.value.slice(0, start) + text + input.value.slice(end)
    try {
      const caret = start + text.length
      input.setSelectionRange(caret, caret)
    } catch {
      // type=number: sin caret — nada que posicionar.
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Backspace en el caret (réplica _onBackspace). */
  function backspace(): void {
    const input = activeInput.value
    if (input == null) return
    let start: number
    let end: number
    try {
      start = input.selectionStart ?? input.value.length
      end = input.selectionEnd ?? start
    } catch {
      start = input.value.length
      end = start
    }
    if (start === end && start > 0) {
      input.value = input.value.slice(0, start - 1) + input.value.slice(end)
      try {
        input.setSelectionRange(start - 1, start - 1)
      } catch { /* type=number */ }
    } else if (start !== end) {
      input.value = input.value.slice(0, start) + input.value.slice(end)
      try {
        input.setSelectionRange(start, start)
      } catch { /* type=number */ }
    } else {
      return
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return { activeInput, layout, visible, show, hide, release, insertText, backspace }
})
