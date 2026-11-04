/**
 * TekLive Rest · Toast store (mini) — feedback de éxitos/errores del POS.
 * Elección simple: un solo toast visible a la vez, auto-dismiss 3.5s.
 * Los estados vacíos/cargando usan AppSpinner/AppBanner inline; el toast es
 * solo para confirmaciones transitorias (folio creado, cobro OK, etc.).
 */

import { defineStore } from 'pinia'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

let nextToastId = 1

export const useToastStore = defineStore('toast', {
  state: () => ({
    current: null as ToastState | null,
    timer: null as ReturnType<typeof setTimeout> | null,
  }),

  actions: {
    show(kind: ToastKind, message: string, durationMs = 3500): void {
      if (this.timer != null) clearTimeout(this.timer)
      this.current = { id: nextToastId++, kind, message }
      this.timer = setTimeout(() => {
        this.current = null
        this.timer = null
      }, durationMs)
    },

    success(message: string): void {
      this.show('success', message)
    },

    error(message: string): void {
      this.show('error', message, 5000)
    },

    dismiss(): void {
      if (this.timer != null) clearTimeout(this.timer)
      this.current = null
      this.timer = null
    },
  },
})
