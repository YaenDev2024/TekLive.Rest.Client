/**
 * TekLive Rest · Floors store (Fase 4) — réplica de FloorProvider de
 * CrazyWings (lib/providers/floor_provider.dart) adaptada al API Rest:
 *
 * - floors[]: pisos de la sucursal (GET /api/rest/floors, backend Fase 4
 *   en construcción en paralelo por otro agente — BusinessSuite).
 * - selectedFloor: piso elegido antes de abrir el POS/caja (réplica
 *   selectFloor de module_selection_screen.dart L22-31/L49-56).
 * - isRestaurantFloor(id): floorId === 2 — HARDCODE heredado del original
 *   `_isRestaurantFloor` (module_selection_screen.dart L13-15), que también
 *   fija el modo restaurante al piso 2. Si el backend algún día expone un
 *   flag por piso, este getter se reemplaza por ese campo.
 * - FALLBACK de desarrollo: mientras el endpoint GET /api/rest/floors NO
 *   exista (otro agente lo está creando), si la petición falla con 404/405
 *   usamos los 2 pisos demo (Piso 1 / Piso 2) y logueamos un console.warn.
 *   TODO(backend): cuando el endpoint real esté integrado, eliminar el
 *   bloque FALLBACK de fetchFloors() — desaparece solo al devolver 200.
 */

import { defineStore } from 'pinia'
import { getFloors, type RestFloorResponse } from '../api/rest'
import { ApiError } from '../api/client'
import { POS_SUCURSAL_ID } from './catalog'

/** Pisos demo mientras el endpoint real no existe (ver TODO arriba). */
const FALLBACK_FLOORS: RestFloorResponse[] = [
  { floorId: 1, name: 'Piso 1', description: null },
  { floorId: 2, name: 'Piso 2', description: null },
]

export const useFloorsStore = defineStore('floors', {
  state: () => ({
    floors: [] as RestFloorResponse[],
    selectedFloor: null as RestFloorResponse | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    /**
     * ¿Modo restaurante (mesas)? — HARDCODE floorId === 2, réplica EXACTA
     * de `_isRestaurantFloor` del Flutter original (L13-15).
     */
    isRestaurantFloor: () => (floorId: number): boolean =>
      floorId === 2,
  },

  actions: {
    /**
     * Carga los pisos de la sucursal (réplica loadFloors). Al éxito limpia
     * error; al fallo (excepto 404/405 → fallback) deja floors vacío y
     * expone el mensaje para la vista.
     */
    async fetchFloors(): Promise<void> {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        const { data } = await getFloors()
        this.floors = data ?? []
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
          // TODO(backend): FALLBACK TEMPORAL mientras GET /api/rest/floors no
          // existe (otro agente lo crea en BusinessSuite). Al integrarse el
          // endpoint real este bloque deja de ejecutarse (200 con datos).
          console.warn(
            '[floors] GET /api/rest/floors no disponible (404/405) — usando pisos demo de desarrollo (fallback temporal).',
          )
          this.floors = structuredClone(FALLBACK_FLOORS)
        } else {
          this.floors = []
          this.error = err instanceof ApiError && err.status !== 0
            ? err.message
            : 'No se pudo conectar con el servidor. Verifica tu conexión.'
        }
      } finally {
        this.loading = false
      }
    },

    /** Réplica selectFloor: guarda el piso elegido (o null). */
    selectFloor(floor: RestFloorResponse | null): void {
      this.selectedFloor = floor
    },

    /** Busca un piso por id (réplica del loop de _openModuleForFloor). */
    byId(floorId: number): RestFloorResponse | null {
      return this.floors.find((f) => f.floorId === floorId) ?? null
    },

    /** Limpia estado (logout). */
    reset(): void {
      this.floors = []
      this.selectedFloor = null
      this.error = null
    },
  },
})

/** Re-export para vistas (evita importar desde api/ dos veces). */
export type { RestFloorResponse }
export { POS_SUCURSAL_ID }
