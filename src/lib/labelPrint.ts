import type { LabelSize } from '@/types/config.types'

/**
 * CSS de impresión de ETIQUETAS, compartido por el modal de productos y el de
 * traslados. Antes cada uno tenía el suyo y los dos imprimían las N etiquetas
 * en UNA sola hoja, así que la impresora de etiquetas sacaba solo la primera.
 *
 * ── Por qué fallaba (medido con Chrome headless, contando páginas del PDF) ──
 *
 * El contenedor era `position: fixed`. Un elemento fijo NO se fragmenta en
 * medios paginados: Chrome lo pinta en una página y corta el resto. Con eso
 * puesto da igual todo lo demás — se probaron break-after, break-inside, sacar
 * el flex y fijar el tamaño de página, y las siete combinaciones daban 1 hoja.
 *
 * Pero el fixed no estaba de adorno: compensaba que el truco de aislamiento
 * (body > * { visibility: hidden }) deja el layout oculto OCUPANDO ESPACIO. Al
 * sacarlo sin más, las etiquetas arrancaban después de la app: 38 páginas en
 * vez de 6.
 *
 * ── La solución ──
 *
 * Portal a document.body + display:none en los hermanos. display:none sí saca
 * del flujo, así que el contenedor queda static y pagina normalmente. Con eso,
 * 6 etiquetas = 6 páginas, en 38×25, en 50×30 y degradando a carta.
 *
 * NO se toca receiptPrint.ts: un recibo térmico es UNA página continua
 * (size: 80mm auto), así que ahí el fixed es correcto. Esto es específico de lo
 * que tiene que paginar.
 */

/** Clase que marca cada etiqueta imprimible. La CSS de abajo la usa. */
export const LABEL_PRINT_CLASS = 'gmura-print-label'

export function buildLabelPrintCss(containerId: string, size: LabelSize): string {
  return `
    @media print {
      /* display:none (no visibility:hidden): saca del flujo, así el contenedor
         puede ser static y fragmentarse en páginas. */
      body > *:not(#${containerId}) { display: none !important; }

      #${containerId} {
        display: block !important;
        position: static !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
      }

      /* Una etiqueta por página. El :last-child evita la hoja en blanco final. */
      #${containerId} .${LABEL_PRINT_CLASS} {
        break-inside: avoid;
        page-break-inside: avoid;
        break-after: page;
        page-break-after: always;
      }
      #${containerId} .${LABEL_PRINT_CLASS}:last-child {
        break-after: auto;
        page-break-after: auto;
      }

      /* Tamaño de página EXPLÍCITO = el de la etiqueta configurada. Con
         size:auto la página la decide el driver y, si no coincide con la
         etiqueta física, sale mal aunque los saltos estén bien. */
      @page {
        margin: 0;
        size: ${size.width_mm}mm ${size.height_mm}mm;
      }
    }
  `
}

/**
 * Qué etiquetas recibe la superficie de impresión: la tanda completa, o una
 * sola cuando se pidió una reimpresión puntual desde una fila.
 *
 * Vive acá y no inline en cada modal por la misma razón que el CSS: dos copias
 * de la misma regla es exactamente cómo el bug del position:fixed terminó
 * viviendo en dos lugares.
 */
export function labelsToPrint<T extends { key: string }>(
  todas: T[],
  soloKey: string | null,
): T[] {
  if (soloKey === null) return todas
  return todas.filter((l) => l.key === soloKey)
}
