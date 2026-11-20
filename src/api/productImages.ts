/**
 * TekLive Rest · Caché de object URLs para las imágenes de producto.
 *
 * PROBLEMA QUE RESUELVE
 * El endpoint de imágenes (`GET /api/rest/catalog/templates/{id}/image`) está
 * protegido por AppApiKeyMiddleware (header `X-Api-Key`) y por el JWT en
 * `Authorization: Bearer`. Un `<img :src="…">` NO puede enviar headers: el
 * navegador haría la petición sin auth → 401 "Aplicación no autorizada" y la
 * tarjeta quedaría rota. Por eso el binario se descarga con `apiDownload()`
 * (fetch con headers + reintento único en 401) y se pinta como object URL.
 *
 * CONTRATO
 * - `loadProductImage(id)` → object URL listo para `<img>`, o `null` cuando el
 *   producto no tiene imagen (404) o la descarga falló transitoriamente. Nunca
 *   lanza: la vista solo necesita saber si hay foto o no (fallback por
 *   categoría). Un 404 se recuerda; un fallo de red/5xx se olvida para que la
 *   próxima petición lo reintente.
 * - Deduplicación: un solo fetch por id aunque N componentes lo pidan a la vez
 *   (se cachea la PROMESA, no el resultado).
 * - `peekProductImage(id)` → lectura SINCRÓNICA para plantillas: el object URL
 *   si ya está listo, `null` si se sabe que no hay imagen, `undefined` si aún
 *   se está descargando.
 * - `invalidateProductImage(id)` → revoca el object URL y borra la entrada.
 *   Se usa al subir/reemplazar la imagen de un producto. Si la descarga todavía
 *   estaba en vuelo, la entrada se marca como liberada y el object URL que
 *   produzca después se revoca en el acto (no se filtra memoria).
 * - `releaseProductImage(id)` → revoca el object URL y olvida la entrada (una
 *   petición posterior la vuelve a descargar, normalmente desde la caché HTTP
 *   del navegador por ETag/Cache-Control).
 *
 * CICLO DE VIDA (decisión documentada)
 * La caché vive durante toda la sesión del SPA y NO se revoca al desmontar
 * cada tarjeta: en el POS el mismo catálogo se pinta una y otra vez (cambio de
 * categoría, re-render del carrito), así que revocar al desmontar provocaría
 * una descarga y un object URL nuevo en cada tick. El coste es acotado (un
 * WebP por producto visible) y se libera explícitamente al reemplazar la
 * imagen (`invalidateProductImage`) o al cerrar sesión (`clearProductImages`).
 */
import { ApiError, apiDownload } from './client'
import { productImagePath } from './rest'

type ImageStatus = 'pending' | 'ready' | 'missing'

/** Entrada de caché: la promesa compartida + el object URL que produce. */
interface CacheEntry {
  status: ImageStatus
  /** Promesa single-flight: los pedidos concurrentes comparten esta. */
  promise: Promise<string | null>
  /** Object URL ya creado (null = sin imagen, pendiente o ya liberada). */
  objectUrl: string | null
  /**
   * `true` si la entrada se invalidó/liberó mientras la descarga seguía en
   * vuelo. La entrada ya salió del mapa, así que si la promesa resuelve con un
   * object URL hay que revocarlo en el acto: nadie más lo va a liberar.
   */
  disposed: boolean
}

const cache = new Map<number, CacheEntry>()

/** Revoca con seguridad (un object URL ya revocado no debe romper nada). */
function revoke(objectUrl: string | null): void {
  if (objectUrl == null) return
  try {
    URL.revokeObjectURL(objectUrl)
  } catch {
    // Entornos sin revoke (jsdom antiguo): no es un fallo funcional.
  }
}

/** Resultado de la descarga: url (éxito), miss definitivo (404) o transitorio. */
type DownloadOutcome =
  | { kind: 'ready'; objectUrl: string }
  | { kind: 'missing' }
  | { kind: 'error' }

/** Descarga el binario y lo convierte en object URL. */
async function downloadImage(productId: number): Promise<DownloadOutcome> {
  try {
    const blob = await apiDownload(productImagePath(productId))
    if (blob.size === 0) return { kind: 'missing' }
    return { kind: 'ready', objectUrl: URL.createObjectURL(blob) }
  } catch (err) {
    // 404 = el producto no tiene imagen: estado NORMAL, no un error definitivo.
    // 401 = sesión terminada (auth.ts ya redirige a /login).
    // El resto (red, 5xx) es transitorio: no se cachea como "sin imagen" para
    // siempre, la próxima petición lo reintenta.
    if (err instanceof ApiError && err.status === 404) return { kind: 'missing' }
    return { kind: 'error' }
  }
}

/**
 * Object URL de la imagen del producto (caché + deduplicación).
 * `null` si no existe o la descarga falló. Nunca lanza.
 *
 * @example
 * const url = await loadProductImage(template.id)
 */
export function loadProductImage(productId: number): Promise<string | null> {
  const existing = cache.get(productId)
  if (existing != null) return existing.promise

  const entry: CacheEntry = {
    status: 'pending',
    objectUrl: null,
    disposed: false,
    promise: Promise.resolve(null),
  }
  entry.promise = downloadImage(productId).then((outcome) => {
    if (outcome.kind === 'ready') {
      // Carrera real: entre el `load` y esta resolución pudo llegar un
      // `invalidateProductImage` (el usuario reemplazó la foto) o un
      // `clearProductImages` (logout). En ese momento la entrada ya no estaba
      // en el mapa, así que este object URL nace huérfano: se revoca ya y se
      // responde null para que la vista caiga al fallback y vuelva a pedir la
      // imagen nueva cuando corresponda.
      if (entry.disposed) {
        revoke(outcome.objectUrl)
        return null
      }
      entry.objectUrl = outcome.objectUrl
      entry.status = 'ready'
      return outcome.objectUrl
    }
    if (outcome.kind === 'missing') {
      // 404 definitivo: no tiene sentido volver a preguntar en esta sesión.
      entry.status = 'missing'
      return null
    }
    // Fallo transitorio: se responde null (la vista cae al arte por categoría)
    // pero se olvida la entrada para que la próxima petición reintente.
    // Solo si sigue siendo la entrada vigente: si fue invalidada, `cache` ya
    // puede tener una entrada nueva (con su propia descarga) y no se debe
    // borrar la de otro.
    if (cache.get(productId) === entry) cache.delete(productId)
    return null
  })
  cache.set(productId, entry)
  return entry.promise
}

/**
 * Lectura SINCRÓNICA para plantillas/computed:
 * · `string` → object URL listo
 * · `null`   → se sabe que no hay imagen (404 definitivo)
 * · `undefined` → todavía se está descargando (o falló de forma transitoria:
 *   el llamador debe usar loadProductImage para reintentar)
 */
export function peekProductImage(productId: number): string | null | undefined {
  const entry = cache.get(productId)
  if (entry == null) return undefined
  if (entry.status === 'ready') return entry.objectUrl
  if (entry.status === 'missing') return null
  return undefined
}

/**
 * Invalida la entrada (tras subir o reemplazar la imagen) y revoca el object
 * URL anterior para no filtrar memoria. La próxima petición descarga de nuevo.
 *
 * ⚠️ El llamador debe haber quitado ya ese object URL del DOM (ver
 * refreshCardImage en ProductEditorView): revocar un blob todavía referenciado
 * por un `<img>` dispara @error y oculta la imagen nueva.
 */
export function invalidateProductImage(productId: number): void {
  const entry = cache.get(productId)
  if (entry == null) return
  // Marcar ANTES de revocar/borrar: si la descarga aún está en vuelo no hay
  // object URL que revocar todavía, y la promesa lo creará después. La marca
  // es lo que permite liberarlo en el `.then` (ver loadProductImage).
  entry.disposed = true
  revoke(entry.objectUrl)
  entry.objectUrl = null
  cache.delete(productId)
}

/**
 * Revoca el object URL y olvida la entrada. La próxima petición vuelve a
 * descargarla (normalmente desde la caché HTTP del navegador).
 */
export function releaseProductImage(productId: number): void {
  invalidateProductImage(productId)
}

/** Libera TODA la caché (logout / cambio de sucursal). */
export function clearProductImages(): void {
  for (const entry of cache.values()) {
    // Misma carrera que en invalidateProductImage: una descarga en vuelo
    // crearía su object URL después de vaciar el mapa. La marca hace que el
    // `.then` lo revoque al resolver.
    entry.disposed = true
    revoke(entry.objectUrl)
    entry.objectUrl = null
  }
  cache.clear()
}
