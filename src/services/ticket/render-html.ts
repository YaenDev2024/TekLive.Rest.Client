/**
 * TekLive Rest · Renderer HTML del TicketDoc (Fase 3c).
 *
 * Renderiza el MISMO documento que se enviaría a la térmica: monospace a 48
 * columnas, @page 80mm (el original imprime PaperSize.mm80), margins 0.
 * printTicket crea un iframe oculto y manda el HTML al diálogo de impresión
 * del navegador (la impresora térmica queda como default del sistema).
 *
 * MEDIDAS FÍSICAS (ronda fidelidad): 48 cols deben ocupar EXACTAMENTE 80mm
 * → font-size = 80mm / 48 / 0.6 (ancho de Courier) = 2.78mm ≈ 10.5px.
 * Con px fijos las filas de 48 chars se desbordan del papel (bug visto en
 * el PDF: 'TOTAL $40.00' doble salía del ticket). 'double' = 2× esa medida
 * (réplica size2 ESC/POS). Las filas usan flex (justificación exacta sin
 * depender del filler — nunca se desbordan).
 */

import type { TicketDoc, TicketLine } from './types'
import { TICKET_LOGO_URL } from './types'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Estilo inline de una celda (bold/double) — réplica PosStyles por columna. */
function cellStyle(bold?: boolean, double?: boolean): string {
  const styles: string[] = []
  if (double) styles.push('font-size:5.56mm')
  if (bold) styles.push('font-weight:700')
  return styles.length > 0 ? ` style="${styles.join(';')}"` : ''
}

function renderTextLine(line: Extract<TicketLine, { kind: 'text' }>): string {
  // Alineación por CSS (el pad manual con nbsp desbordaba en líneas dobles).
  // white-space:pre conserva los espacios internos del texto.
  const align = line.align === 'center' ? 'center' : line.align === 'right' ? 'right' : 'left'
  const base = `text-align:${align};white-space:pre`
  const style = cellStyle(line.bold, line.double)
  return `<div class="tl"${style ? style.replace('style="', `style="${base};`) : ` style="${base}"`}>${escapeHtml(line.text)}</div>`
}

function renderLine(line: TicketLine): string {
  switch (line.kind) {
    case 'text':
      return renderTextLine(line)
    case 'row': {
      // Flex space-between = justificación de columnas EXACTA (el filler
      // monospace a 48 chars se desbordaba del papel de 80mm).
      const leftStyle = cellStyle(line.leftBold ?? line.bold, line.leftDouble ?? line.double)
      const rightStyle = cellStyle(line.rightBold ?? line.bold, line.rightDouble ?? line.double)
      return (
        `<div class="tl tl-row">` +
        `<span${leftStyle}>${escapeHtml(line.left)}</span>` +
        `<span${rightStyle}>${escapeHtml(line.right)}</span>` +
        `</div>`
      )
    }
    case 'hr':
      return `<div class="tl tl-hr">${'-'.repeat(width())}</div>`
    case 'feed':
      return '<div class="tl">&nbsp;</div>'.repeat(Math.max(0, line.n))
    case 'cut':
      return '<div class="tl tl-cut">---</div>'
    case 'logo':
      // Réplica generator.image(logo3.png) centrado (L944): ~384px printable
      // de 80mm → 50mm de ancho visual.
      return `<div class="tl tl-logo"><img src="${TICKET_LOGO_URL}" style="width:50mm" alt="logo" /></div>`
    default:
      return ''
  }
}

/** Ancho lógico del ticket (48 cols = PaperSize.mm80). */
function width(): number {
  return 48
}

/** HTML completo imprimible (@page 80mm, Courier, 48 cols = 80mm exactos). */
export function renderTicketHtml(doc: TicketDoc): string {
  const body = doc.lines.map((l) => renderLine(l)).join('\n')
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Ticket</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: 'Courier New', Courier, monospace;
    /* 48 chars × 0.6em = 80mm → font-size 2.78mm. Nada se desborda. */
    font-size: 2.78mm;
    line-height: 1.25;
  }
  .ticket {
    width: 80mm;
    padding: 2mm 1mm;
  }
  .tl {
    font-size: 2.78mm;
    line-height: 1.25;
    white-space: pre;
  }
  .tl-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    white-space: pre;
  }
  .tl-hr { color: #000; overflow: hidden; }
  .tl-cut { color: #888; }
  .tl-logo { text-align: center; }
  .tl-logo img { display: inline-block; max-width: 100%; }
  @media print {
    .ticket { width: auto; padding: 0; }
  }
</style>
</head>
<body>
<div class="ticket">
${body}
</div>
</body>
</html>`
}

/**
 * Imprime el documento: iframe oculto + print() del navegador. El usuario
 * elige la térmica (quedará como predeterminada del POS). Devuelve true si
 * el diálogo se lanzó.
 */
export function printTicket(doc: TicketDoc): boolean {
  try {
    const html = renderTicketHtml(doc)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)
    const win = iframe.contentWindow
    if (win == null) {
      document.body.removeChild(iframe)
      return false
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    // Espera al layout del iframe antes de invocar el diálogo.
    const print = (): void => {
      try {
        win.focus()
        win.print()
      } finally {
        // Limpieza diferida: el diálogo necesita el documento vivo.
        setTimeout(() => {
          try {
            document.body.removeChild(iframe)
          } catch {
            // El iframe ya no existe (navegación/recarga): nada que limpiar.
          }
        }, 1000)
      }
    }
    if (win.document.readyState === 'complete') {
      print()
    } else {
      win.addEventListener('load', print, { once: true })
    }
    return true
  } catch {
    return false
  }
}
