/**
 * Estado interno de una orden en el mock de órdenes (Fase 3b).
 * Separado de la lógica para que los stores solo importen el tipo.
 */

export interface MockOrderItem {
  id: number
  productName: string
  quantity: number
  price: number
  notes: string | null
}

export interface MockOrder {
  id: number
  dailyOrderNumber: number
  orderStatus: 'pendiente' | 'preparando' | 'listo' | 'entregado' | 'pagado' | 'cancelada'
  total: number
  createdAt: string
  itemCount: number
  waiterName: string
  items: MockOrderItem[]
}
