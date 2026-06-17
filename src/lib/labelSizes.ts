import type { LabelSize } from '@/types/config.types'

// Catálogo por defecto de tamaños de etiqueta. A partir de la fase de
// parametrización los tamaños viven en stores.config.label_sizes y son
// gestionables desde Configuración. Esta lista solo se usa como fallback/seed
// cuando la tienda aún no tiene tamaños configurados.
//
// IMPORTANTE: los ids de los 3 base son las strings del antiguo LabelFormat
// ('38x25', '50x30', '58x40') para que la migración lazy mapee directamente un
// label_format viejo a su label_default_size_id sin reescribir nada.
export const DEFAULT_LABEL_SIZES: LabelSize[] = [
  { id: '38x25', name: 'Estándar', width_mm: 38, height_mm: 25 },
  { id: '50x30', name: 'Mediana', width_mm: 50, height_mm: 30 },
  { id: '58x40', name: 'Grande', width_mm: 58, height_mm: 40 },
]

export const DEFAULT_LABEL_SIZE_ID = '38x25'

// ─── Escalado proporcional ──────────────────────────────────────────────────
// El contenido escala uniformemente respecto al tamaño de referencia 38×25
// (factor 1.0 = render idéntico al histórico). Se usa min(w/refW, h/refH) tipo
// "contain" para preservar proporciones y garantizar que el contenido no
// desborde peor que la referencia en ninguna de las dos dimensiones.
export const REF_W = 38
export const REF_H = 25
export const MIN_FACTOR = 0.6
export const MAX_FACTOR = 2.5
export const MIN_BARCODE_H = 13

// Umbrales de ancho para escaneabilidad del código de barras (validación en
// Config): advertencia ámbar por debajo de WARN_WIDTH, bloqueo duro por debajo
// de MIN_WIDTH.
export const WARN_WIDTH = 30
export const MIN_WIDTH = 20

// Multiplicador global del tamaño de fuente sobre las bases históricas.
// AFÍNALO AQUÍ tras ver la impresión física: 1.30 = +30% (subir para más
// grande, bajar a 1.2 para más chico). Solo afecta a las fuentes; el
// padding, el borde y el código de barras no dependen de esto.
export const FONT_SCALE = 1.3

// La marca se imprime sobre el nombre, un poco más pequeña: 80% del nombre.
const BRAND_RATIO = 0.8

// Medidas base de fuente (valores históricos originales, a factor 1.0 y
// FONT_SCALE 1.0). El tamaño de fuente efectivo es BASE * FONT_SCALE * factor.
const BASE_NAME_PT = 5.5
const BASE_DETAIL_PT = 4.5
const BASE_SKU_PT = 4
const BASE_PRICE_PT = 6.5
// El padding, borde y barcode mantienen las bases históricas (escalan solo por
// factor, sin FONT_SCALE).
const BASE_PAD_Y_MM = 1
const BASE_PAD_X_MM = 1.5
const BASE_BORDER_MM = 0.3
const BASE_BARCODE_H = 24
const BASE_BARCODE_W = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface LabelStyle {
  width: string
  height: string
  padding: string
  border: string
  brandFs: string
  nameFs: string
  detailFs: string
  skuFs: string
  priceFs: string
  barcodeHeight: number
  barcodeWidth: number
  factor: number
}

// Función pura: deriva todas las medidas CSS y parámetros de barcode a partir
// de un tamaño. La usan tanto la impresión real (LabelCard) como la preview de
// Config para que nunca diverjan.
export function deriveLabelStyle(size: LabelSize): LabelStyle {
  const factor = clamp(
    Math.min(size.width_mm / REF_W, size.height_mm / REF_H),
    MIN_FACTOR,
    MAX_FACTOR,
  )

  // Las fuentes escalan por factor Y por FONT_SCALE; el resto solo por factor.
  const fontFactor = FONT_SCALE * factor

  return {
    width: `${size.width_mm}mm`,
    height: `${size.height_mm}mm`,
    padding: `${round2(BASE_PAD_Y_MM * factor)}mm ${round2(BASE_PAD_X_MM * factor)}mm`,
    border: `${round2(BASE_BORDER_MM * factor)}mm solid #ccc`,
    brandFs: `${round2(BASE_NAME_PT * BRAND_RATIO * fontFactor)}pt`,
    nameFs: `${round2(BASE_NAME_PT * fontFactor)}pt`,
    detailFs: `${round2(BASE_DETAIL_PT * fontFactor)}pt`,
    skuFs: `${round2(BASE_SKU_PT * fontFactor)}pt`,
    priceFs: `${round2(BASE_PRICE_PT * fontFactor)}pt`,
    barcodeHeight: Math.max(MIN_BARCODE_H, Math.round(BASE_BARCODE_H * factor)),
    barcodeWidth: Math.max(1, Math.round(BASE_BARCODE_W * factor)),
    factor,
  }
}

// Resuelve un tamaño por id. Devuelve undefined si no existe (ej. un default
// que apunta a un tamaño ya eliminado).
export function findLabelSize(
  sizes: LabelSize[],
  id: string | null | undefined,
): LabelSize | undefined {
  if (!id) return undefined
  return sizes.find((s) => s.id === id)
}

// Genera un id estable y opaco para un tamaño nuevo. Los tamaños se referencian
// por id (label_default_size_id), por lo que nunca debe cambiar al renombrar.
export function newLabelSizeId(): string {
  return `ls_${crypto.randomUUID().slice(0, 8)}`
}
