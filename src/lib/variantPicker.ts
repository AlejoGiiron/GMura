// ─────────────────────────────────────────────────────────────────────────────
// variantPicker — lógica de habilitación/selección para el selector talla×color.
//
// Problema que resuelve: la matriz talla×color de un producto suele ser DISPERSA
// (no existen todas las combinaciones). El selector anterior habilitaba un botón
// de talla cruzándolo contra el color YA elegido (y viceversa), lo que dejaba
// celdas válidas INALCANZABLES desde el estado inicial. Ej: STIL ROTOS 32/GRIS —
// GRIS solo existe en talla 32, pero con el default (talla 28) GRIS salía
// deshabilitado y la 32 también.
//
// Reglas (decididas):
//   · Talla habilitada  = existe ALGUNA variante de esa talla con stock
//     disponible > 0 (independiente del color elegido).
//   · Color habilitado  = existe ALGUNA variante de ese color con stock
//     disponible > 0 (independiente de la talla elegida).
//   · Al elegir un eje, se autoajusta el otro a una combinación válida con stock.
//   · El estado inicial cae en la primera combinación existente con stock.
//
// `stock_qty` aquí es el DISPONIBLE ya neteado de reservas (usePOSProducts ya
// resta reserved_qty). Por eso un color/talla cuyas variantes están todas en
// disponible 0 (p. ej. 100% reservadas en separados) queda correctamente
// deshabilitado.
// ─────────────────────────────────────────────────────────────────────────────

/** Forma mínima que necesita el picker; POSVariant la cumple. */
export interface PickerVariant {
  size: string | null
  color: string | null
  /** Disponible real (stock físico − reservado). */
  stock_qty: number
}

export interface PickerSelection {
  size: string | null
  color: string | null
}

/** Tallas presentes (dedupe, preserva orden, descarta null/''). */
export function pickerSizes(variants: PickerVariant[]): string[] {
  return [...new Set(variants.map((v) => v.size).filter(Boolean))] as string[]
}

/** Colores presentes (dedupe, preserva orden, descarta null/''). */
export function pickerColors(variants: PickerVariant[]): string[] {
  return [...new Set(variants.map((v) => v.color).filter(Boolean))] as string[]
}

/** ¿El producto tiene eje de talla? (alguna variante con talla) */
function hasSizeAxis(variants: PickerVariant[]): boolean {
  return variants.some((v) => v.size !== null && v.size !== '')
}

/** ¿El producto tiene eje de color? (alguna variante con color) */
function hasColorAxis(variants: PickerVariant[]): boolean {
  return variants.some((v) => v.color !== null && v.color !== '')
}

/**
 * Variante que corresponde a la selección actual. Respeta ejes ausentes:
 * si el producto no tiene tallas, no filtra por talla (y análogo con color).
 */
export function matchVariant<T extends PickerVariant>(
  variants: T[],
  size: string | null,
  color: string | null,
): T | undefined {
  const bySize = hasSizeAxis(variants)
  const byColor = hasColorAxis(variants)
  return variants.find(
    (v) => (!bySize || v.size === size) && (!byColor || v.color === color),
  )
}

/** Talla habilitada = existe alguna variante de esa talla con stock, sin importar el color. */
export function sizeHasStock(variants: PickerVariant[], size: string): boolean {
  return variants.some((v) => v.size === size && v.stock_qty > 0)
}

/** Color habilitado = existe alguna variante de ese color con stock, sin importar la talla. */
export function colorHasStock(variants: PickerVariant[], color: string): boolean {
  return variants.some((v) => v.color === color && v.stock_qty > 0)
}

/** ¿La combinación exacta (talla, color) existe y tiene stock disponible? */
export function comboHasStock(
  variants: PickerVariant[],
  size: string | null,
  color: string | null,
): boolean {
  const m = matchVariant(variants, size, color)
  return !!m && m.stock_qty > 0
}

/**
 * Selección inicial: la primera combinación EXISTENTE con stock disponible.
 * Si ninguna variante tiene stock, cae en la primera variante real (todo saldrá
 * deshabilitado, que es lo correcto). Nunca inventa una celda inexistente.
 */
export function initialPickerSelection(
  variants: PickerVariant[],
): PickerSelection {
  const bySize = hasSizeAxis(variants)
  const byColor = hasColorAxis(variants)
  const base = variants.find((v) => v.stock_qty > 0) ?? variants[0]
  return {
    size: bySize ? (base?.size ?? null) : null,
    color: byColor ? (base?.color ?? null) : null,
  }
}

/**
 * Dado que se eligió la talla `size`, devuelve un color válido:
 *   1. mantiene `currentColor` si (size, currentColor) tiene stock;
 *   2. si no, el color de la primera variante de esa talla con stock;
 *   3. si la talla no tiene ninguna variante con stock (no debería, porque el
 *      botón estaría deshabilitado), conserva `currentColor`.
 */
export function reconcileColorForSize(
  variants: PickerVariant[],
  size: string | null,
  currentColor: string | null,
): string | null {
  if (!hasColorAxis(variants)) return null
  if (comboHasStock(variants, size, currentColor)) return currentColor
  const partner = variants.find((v) => v.size === size && v.stock_qty > 0)
  return partner ? partner.color : currentColor
}

/** Simétrico a reconcileColorForSize: fija una talla válida para el color elegido. */
export function reconcileSizeForColor(
  variants: PickerVariant[],
  color: string | null,
  currentSize: string | null,
): string | null {
  if (!hasSizeAxis(variants)) return null
  if (comboHasStock(variants, currentSize, color)) return currentSize
  const partner = variants.find((v) => v.color === color && v.stock_qty > 0)
  return partner ? partner.size : currentSize
}
