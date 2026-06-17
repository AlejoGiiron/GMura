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

// Medidas base (= valores históricos a factor 1.0).
const BASE_NAME_PT = 5.5
const BASE_DETAIL_PT = 4.5
const BASE_SKU_PT = 4
const BASE_PRICE_PT = 6.5
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

  return {
    width: `${size.width_mm}mm`,
    height: `${size.height_mm}mm`,
    padding: `${round2(BASE_PAD_Y_MM * factor)}mm ${round2(BASE_PAD_X_MM * factor)}mm`,
    border: `${round2(BASE_BORDER_MM * factor)}mm solid #ccc`,
    nameFs: `${round2(BASE_NAME_PT * factor)}pt`,
    detailFs: `${round2(BASE_DETAIL_PT * factor)}pt`,
    skuFs: `${round2(BASE_SKU_PT * factor)}pt`,
    priceFs: `${round2(BASE_PRICE_PT * factor)}pt`,
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
