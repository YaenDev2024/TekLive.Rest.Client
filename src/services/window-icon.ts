/**
 * TekLive Rest · Ícono de ventana dinámico por empresa (desktop Tauri).
 *
 * Puerto del `window-icon.ts` de Abogados, con el mismo pipeline:
 * 1. Descarga el logo aprobado de la empresa (endpoint público).
 * 2. Lo rasteriza a RGBA 128x128 en canvas (ícono de ventana).
 * 3. Genera además un PNG 256x256 empaquetado como ICO (accesos directos).
 * 4. Envía ambos al comando `set_window_icon`, que en Windows actualiza la
 *    barra de tareas, Alt-Tab y los .lnk del escritorio/menú inicio.
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

/** Rasteriza la URL para la ventana (RGBA) y para el acceso directo (ICO). */
async function rasterize(
  url: string,
): Promise<{ rgba: number[]; width: number; height: number; iconIco: number[] } | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) return null
  const bitmap = await createImageBitmap(blob)
  try {
    const windowCanvas = document.createElement('canvas')
    windowCanvas.width = ICON_SIZE
    windowCanvas.height = ICON_SIZE
    const windowContext = windowCanvas.getContext('2d', { willReadFrequently: true })
    if (!windowContext) return null
    drawContained(windowContext, bitmap, ICON_SIZE)
    const rgba = windowContext.getImageData(0, 0, ICON_SIZE, ICON_SIZE)

    const shortcutCanvas = document.createElement('canvas')
    shortcutCanvas.width = SHORTCUT_ICON_SIZE
    shortcutCanvas.height = SHORTCUT_ICON_SIZE
    const shortcutContext = shortcutCanvas.getContext('2d')
    if (!shortcutContext) return null
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
    const raster = await rasterize(path)
    // 404 = la empresa aún no tiene logo aprobado: se conserva el de TekLive.
    if (!raster) return false
    if (!isCurrent()) return false
    await tauriInvoke('set_window_icon', {
      rgba: raster.rgba,
      width: raster.width,
      height: raster.height,
      iconIco: raster.iconIco,
    })
    return true
  } catch {
    return false
  }
}

/** Restaura el ícono por defecto de TekLive (logout o empresa sin logo). */
export async function resetWindowIcon(isCurrent: () => boolean = () => true): Promise<boolean> {
  if (!isDesktop()) return true
  try {
    // Se rasteriza el logo de TekLive desde los assets del propio bundle
    // (ruta relativa: en el WebView de Tauri el origen es tauri://localhost).
    const raster = await rasterize('/logo.png')
    if (!raster) return false
    if (!isCurrent()) return false
    await tauriInvoke('set_window_icon', {
      rgba: raster.rgba,
      width: raster.width,
      height: raster.height,
      iconIco: raster.iconIco,
    })
    return true
  } catch {
    return false
  }
}
