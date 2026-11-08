/**
 * TekLive Rest · Etiquetas de rol para la UI.
 *
 * Extraído de HomeView.vue (mapeo idéntico) para reutilizarlo en
 * ModuleSelectView — el header del selector muestra "Rol: {label}".
 *
 * Mapea los roles del JWT Rest (claim role) a etiquetas en español.
 * El fallback devuelve el valor crudo (réplica del default del switch).
 */

/**
 * Etiqueta legible de un rol Rest.
 * RestAdmin/SuperAdmin/RestManager → 'Administrador' (diseño Fase 4:
 * el dueño pidió que manager caiga en 'Administrador', no 'Gerente'),
 * RestCashier → 'Cajero', RestWaiter → 'Mesero', RestKitchen → 'Cocinero'.
 */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'RestAdmin':
    case 'SuperAdmin':
    case 'RestManager':
      return 'Administrador'
    case 'RestCashier':
      return 'Cajero'
    case 'RestWaiter':
      return 'Mesero'
    case 'RestKitchen':
      return 'Cocinero'
    default:
      return role ?? ''
  }
}
