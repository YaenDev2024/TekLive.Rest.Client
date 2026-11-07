/**
 * TekLive Rest · Keyboard store — réplica EXACTA de KeyboardProvider
 * (lib/providers/keyboard_provider.dart de CrazyWings).
 *
 * Teclado virtual PROPIO de la app en TODAS las plataformas (Windows
 * desktop, tablet Android, phone): el input nativo del SO NUNCA aparece
 * (readonly en touch + blur inmediato en móvil; ver VirtualKeyboard.vue).
 *
 * Dos layouts como el original:
 * - Numérico (keyboardType number/decimal): grid 3x4 '789/456/123/0.←',
 *   width 280, aspect 1.4, ← = backspace.
 * - Completo: 4 filas QWERTY con ñ + números arriba, shift/caps, espacio,
 *   backspace (L229-241: normalKeys/shiftKeys).
 *
 * El original inserta un Overlay a pantalla completa; aquí el overlay es
 * un componente montado en App.vue (teleport al body) alimentado por este
 * store. show() registra el input activo; el overlay escribe en él vía
 * inserción en el caret (mismo replaceRange del original).
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
   * Abrir teclado para un input (réplica showKeyboard L16-61). type
   * 'numeric' = grid 3x4; 'text' = QWERTY completo (réplica TextInputType).
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
    // Guardar el inputmode original (numeric/decimal/text) para restaurarlo
    // en release() — el 'none' de supresión es temporal, no destructivo.
    if (input.dataset.vkOriginalInputmode === undefined) {
      const original = input.getAttribute('inputmode')
      input.dataset.vkOriginalInputmode = original ?? ''
    }
  }

  /** Cerrar (réplica hideKeyboard L63-75: botón X o pérdida de foco). */
  function hide(): void {
    visible.value = false
    activeInput.value = null
  }

  /**
   * Restaurar el input al cerrar (X del teclado / Escape): quita el
   * inputmode='none' de supresión del teclado nativo SIN borrar el
   * inputmode ORIGINAL (numeric/decimal) — sin esto, el siguiente tap
   * abriría el layout equivocado (bug encontrado en prueba E2E).
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
   * Inserción en el caret (réplica _onKeyPressed L243-268 / L456-476:
   * replaceRange(start, end, key) + colapsar selección al final del texto
   * insertado). Dispara el evento 'input' para que v-model/onInput reaccionen.
   * Inputs type=number NO soportan selectionStart (DOMException) → fallback:
   * append al final (el teclado numérico es el único que los toca).
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

  /** Backspace en el caret (réplica _onBackspace L270-298 / L478-506). */
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
