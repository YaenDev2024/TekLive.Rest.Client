/**
 * TekLive Rest · Ícono de ventana dinámico por empresa (desktop Tauri).
 *
 * Pipeline:
 * 1. Descarga el logo aprobado de la empresa (endpoint público).
 * 2. Lo rasteriza a RGBA 128x128 en canvas (ícono de ventana).
 * 3. Genera además un PNG 256x256 empaquetado como ICO (accesos directos).
 * 4. `set_window_icon` aplica ventana + barra de tareas (inmediato).
 * 5. `sync_shortcut_icons` ENCOLA el recorrido de .lnk y retorna sin esperar:
 *    el worker COM corre en segundo plano dentro de Rust.
 *
 * El paso 5 solo se pide con sesión válida, porque el recorrido de accesos
 * directos no tiene sentido (ni debe tocar nada) antes de saber qué empresa
 * está activa. Separarlo evita el bloqueo que producía el recorrido previo.
 *
 * Best-effort total: cualquier fallo se ignora y la app conserva su ícono. En
 * web y APK no hace nada (`getPlatform()` no es Desktop).
 */

import { logoPath } from './company-logo'
import { getPlatform } from './device'

/** Tamaño del ícono de ventana (Windows usa hasta 128 en taskbar escalado). */
const ICON_SIZE = 128
/** Tamaño del PNG dentro del ICO de los accesos directos. */
const SHORTCUT_ICON_SIZE = 256

function isDesktop(): boolean {
  return getPlatform() === 'Desktop'
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  // Runtime inyectado en el WebView (mismo patrón que printing/tauri-bridge).
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<T> }
  }
  if (w.__TAURI_INTERNALS__?.invoke) {
    return w.__TAURI_INTERNALS__.invoke(cmd, args)
  }
  // Fallback: paquete npm bundleado.
  const core = (await import('@tauri-apps/api/core')) as {
    invoke: <U>(cmd: string, args?: Record<string, unknown>) => Promise<U>
  }
  return core.invoke<T>(cmd, args)
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  size: number,
): void {
  // Logo centrado sin deformar: escala por el lado más restrictivo.
  const scale = Math.min(size / bitmap.width, size / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  ctx.drawImage(
    bitmap,
    Math.floor((size - width) / 2),
    Math.floor((size - height) / 2),
    width,
    height,
  )
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo generar el icono PNG.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Empaqueta un PNG como ICO de una sola imagen (formato que acepta Windows). */
function makeIco(png: Uint8Array): number[] {
  const ico = new Uint8Array(22 + png.length)
  const header = new DataView(ico.buffer)
  header.setUint16(0, 0, true) // reserved
  header.setUint16(2, 1, true) // type = icon
  header.setUint16(4, 1, true) // una imagen
  header.setUint16(10, 1, true) // planes
  header.setUint16(12, 32, true) // bpp
  header.setUint32(14, png.length, true) // tamaño del PNG
  header.setUint32(18, 22, true) // offset del PNG
  ico.set(png, 22)
  return Array.from(ico)
}

type Raster = { rgba: number[]; width: number; height: number; iconIco: number[] }

/**
 * Rasteriza la URL para la ventana (RGBA) y para el acceso directo (ICO).
 *
 * 404 devuelve null (la empresa aún no tiene logo aprobado: es un caso normal,
 * no un error). Cualquier otro fallo se propaga como excepción para que el
 * llamador lo registre y decida reintentar.
 */
async function rasterize(url: string): Promise<Raster | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`No se pudo descargar el icono (${res.status}).`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('La respuesta del icono no es una imagen.')
  const bitmap = await createImageBitmap(blob)
  try {
    const windowCanvas = document.createElement('canvas')
    windowCanvas.width = ICON_SIZE
    windowCanvas.height = ICON_SIZE
    const windowContext = windowCanvas.getContext('2d', { willReadFrequently: true })
    if (!windowContext) throw new Error('No se pudo crear el contexto del icono de ventana.')
    drawContained(windowContext, bitmap, ICON_SIZE)
    const rgba = windowContext.getImageData(0, 0, ICON_SIZE, ICON_SIZE)

    const shortcutCanvas = document.createElement('canvas')
    shortcutCanvas.width = SHORTCUT_ICON_SIZE
    shortcutCanvas.height = SHORTCUT_ICON_SIZE
    const shortcutContext = shortcutCanvas.getContext('2d')
    if (!shortcutContext) throw new Error('No se pudo crear el contexto del icono del acceso directo.')
    drawContained(shortcutContext, bitmap, SHORTCUT_ICON_SIZE)

    return {
      rgba: Array.from(rgba.data),
      width: ICON_SIZE,
      height: ICON_SIZE,
      iconIco: makeIco(await canvasPng(shortcutCanvas)),
    }
  } finally {
    bitmap.close()
  }
}

/**
 * Aplica el icono activo y, si se pide, encola la sincronización de accesos.
 *
 * Los dos comandos son independientes: si el encolado falla, el icono de la
 * ventana ya quedó aplicado y la sesión sigue siendo válida.
 */
async function applyRasterizedIcon(
  raster: Raster,
  isCurrent: () => boolean,
  syncShortcuts: boolean,
): Promise<boolean> {
  if (!isCurrent()) return false
  await tauriInvoke('set_window_icon', {
    rgba: raster.rgba,
    width: raster.width,
    height: raster.height,
    iconIco: raster.iconIco,
    updateShortcutIcon: syncShortcuts,
  })

  if (!syncShortcuts) return true
  if (!isCurrent()) return false
  try {
    await tauriInvoke('sync_shortcut_icons')
  } catch (error) {
    console.warn('No se pudo encolar la sincronizacion de iconos de accesos directos.', error)
    return false
  }
  return true
}

/**
 * Aplica el logo de la empresa como ícono de ventana y accesos directos.
 *
 * `isCurrent` permite descartar una aplicación tardía: si el usuario cerró
 * sesión (o cambió de empresa) mientras el logo viajaba, no debe pisar el
 * ícono nuevo.
 */
export async function applyCompanyWindowIcon(
  companyId: number,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isDesktop()) return true
  try {
    const path = logoPath(companyId)
    if (!path) return false
    // Si la empresa no tiene logo aprobado se usa el de TekLive, que también
    // debe quedar en sus accesos directos.
    const raster = (await rasterize(path)) ?? (await rasterize('/logo.png'))
    if (!raster) throw new Error('No se pudo resolver el icono predeterminado.')
    return await applyRasterizedIcon(raster, isCurrent, true)
  } catch (error) {
    console.warn('No se pudo aplicar el icono de la empresa.', error)
    return false
  }
}

/**
 * Restaura el ícono por defecto solo en la ventana.
 *
 * Los accesos directos conservan el logo de la última empresa (decisión del
 * dueño: cerrar sesión no debe dejar los accesos apuntando al ícono genérico).
 */
export async function resetWindowIcon(isCurrent: () => boolean = () => true): Promise<boolean> {
  if (!isDesktop()) return true
  try {
    // Se rasteriza el logo de TekLive desde los assets del propio bundle
    // (ruta relativa: en el WebView de Tauri el origen es tauri://localhost).
    const raster = await rasterize('/logo.png')
    if (!raster) throw new Error('No se pudo resolver el icono predeterminado.')
    return await applyRasterizedIcon(raster, isCurrent, false)
  } catch (error) {
    console.warn('No se pudo restaurar el icono predeterminado.', error)
    return false
  }
}
