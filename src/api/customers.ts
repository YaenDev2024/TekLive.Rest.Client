/**
 * TekLive Rest · API de clientes Rest (Fase 3c · ronda 4).
 *
 * Endpoints reales del backend (commit 0700a12, corriendo en :5171):
 * - GET    api/rest/customers/search?number=X  → 200 { success, data: Customer|null, message }
 *   (200 con data=null si no existe — el 404 rompería el flujo del form)
 * - GET    api/rest/customers/frequent?limit=N → 200 { success, data: Customer[] }
 * - POST   api/rest/customers                  → 201 { success, data } | 400/409 { success:false, Message }
 * - PATCH  api/rest/customers/{id}             → 200 { success, data } | 404 { success:false, Message }
 *
 * Envelope: 2xx usa { success, data, message } (camelCase); los errores usan
 * { Message } (PascalCase) y ApiError ya extrae ambos. Auth idéntica al resto
 * (apiGet/apiPost/apiPatch de client.ts: Bearer + X-Api-Key).
 */

import { apiGet, apiPatch, apiPost, type ApiResult } from './client'
import type {
  CreateCustomerPayload,
  RestCustomer,
  UpdateCustomerPayload,
} from './pos-types'

/** Shape del envelope 2xx de RestCustomersController. */
interface CustomerEnvelope<T> {
  success: boolean
  data: T
  message: string
}

/** GET api/rest/customers/search?number=X → data Customer | null. */
export async function searchCustomer(number: string): Promise<ApiResult<RestCustomer | null>> {
  const { status, data } = await apiGet<CustomerEnvelope<RestCustomer | null>>(
    `/api/rest/customers/search?number=${encodeURIComponent(number)}`,
  )
  return { status, data: data.data }
}

/** GET api/rest/customers/frequent?limit=N → data Customer[]. */
export async function getFrequentCustomers(limit = 50): Promise<ApiResult<RestCustomer[]>> {
  const { status, data } = await apiGet<CustomerEnvelope<RestCustomer[]>>(
    `/api/rest/customers/frequent?limit=${encodeURIComponent(limit)}`,
  )
  return { status, data: data.data }
}

/** POST api/rest/customers → 201 con el Customer creado (envelope desenrollado). */
export async function createCustomer(body: CreateCustomerPayload): Promise<ApiResult<RestCustomer>> {
  const { status, data } = await apiPost<RestCustomer>('/api/rest/customers', body)
  return { status, data: (data as unknown as CustomerEnvelope<RestCustomer>).data }
}

/** PATCH api/rest/customers/{id} → 200 con el Customer actualizado (desenrollado). */
export async function updateCustomer(
  customerId: number,
  body: UpdateCustomerPayload,
): Promise<ApiResult<RestCustomer>> {
  const { status, data } = await apiPatch<RestCustomer>(
    `/api/rest/customers/${encodeURIComponent(customerId)}`,
    body,
  )
  return { status, data: (data as unknown as CustomerEnvelope<RestCustomer>).data }
}
