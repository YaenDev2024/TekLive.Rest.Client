/**
 * TekLive Rest · Renderer HTML del TicketDoc (Fase 3c).
 *
 * Renderiza el MISMO documento que se enviaría a la térmica: monospace a 48
 * columnas, @page 80mm (el original imprime PaperSize.mm80), margins 0.
 * printTicket crea un iframe oculto y manda el HTML al diálogo de impresión
 * del navegador (la impresora térmica queda como default del sistema).
 */

import type { TicketDoc, TicketLine } from './types'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Línea de texto a 48 chars con alineación (center recorta como el Flutter). */
function renderTextLine(line: Extract<TicketLine, { kind: 'text' }>, width: number): string {
  let text = line.text
  if (text.length > width) text = text.substring(0, width)
  let pad = 0
  if (line.align === 'center') {
    pad = Math.max(0, Math.floor((width - text.length) / 2))
  }
  const content = '&nbsp;'.repeat(pad) + escapeHtml(text)
  const styles: string[] = []
  if (line.bold) styles.push('font-weight:700')
  if (line.double) styles.push('font-size:18px;line-height:1.2')
  const styleAttr = styles.length > 0 ? ` style="${styles.join(';')}"` : ''
  return `<div class="tl"${styleAttr}>${content}</div>`
}

function renderLine(line: TicketLine, width: number): string {
  switch (line.kind) {
    case 'text':
      return renderTextLine(line, width)
    case 'row': {
      // left + puntos de relleno + right (justificación monospace exacta).
      const left = line.left.length > width ? line.left.substring(0, width) : line.left
      let right = line.right
      const space = width - left.length - right.length
      if (space < 1) {
        right = right.substring(0, Math.max(0, width - left.length - 1))
      }
      const filler = ' '.repeat(Math.max(1, width - left.length - right.length))
      const styleAttr = line.bold ? ' style="font-weight:700"' : ''
      return `<div class="tl"${styleAttr}>${escapeHtml(left + filler + right)}</div>`
    }
    case 'hr':
      return `<div class="tl tl-hr">${'-'.repeat(width)}</div>`
    case 'feed':
      return '<div class="tl">&nbsp;</div>'.repeat(Math.max(0, line.n))
    case 'cut':
      return '<div class="tl tl-cut">---</div>'
    default:
      return ''
  }
}

/** HTML completo imprimible (@page 80mm, Courier New 12px, línea 1.25). */
export function renderTicketHtml(doc: TicketDoc): string {
  const body = doc.lines.map((l) => renderLine(l, doc.width)).join('\n')
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
    font-size: 12px;
    line-height: 1.25;
  }
  .ticket {
    width: 80mm;
    padding: 4mm 2mm;
  }
  .tl {
    white-space: pre;
    font-size: 12px;
    line-height: 1.25;
  }
  .tl-hr { color: #000; }
  .tl-cut { color: #888; }
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
