// Helpers para resolver un escaneo de código de barras. El lector actúa como un
// teclado que "teclea" el código exacto seguido de un Enter (ver useBarcode). El
// match es siempre exacto contra variants.barcode. Lógica pura para poder
// testearla sin React ni red.

/** Encuentra el primer ítem con `barcode` exactamente igual a `code`, o null. */
export function findByBarcode<T extends { barcode: string | null }>(
  items: readonly T[],
  code: string,
): T | null {
  const c = code.trim()
  if (!c) return null
  return items.find((i) => i.barcode === c) ?? null
}

// ── Escaneo en Devoluciones (Paso 2: marcar lo que se devuelve) ────────────────

export type ScanReturnItem = {
  variant_id: string
  barcode: string | null
  qty: number
  qty_returned: number
}

export type ReturnScanResolution<T> =
  // El código no corresponde a ningún ítem de la orden.
  | { kind: 'not-found' }
  // El ítem existe pero ya fue devuelto por completo (max disponible = 0).
  | { kind: 'exhausted'; item: T }
  // Ya se marcó la cantidad máxima devolvible de ese ítem en esta devolución.
  | { kind: 'at-cap'; item: T; max: number }
  // Se puede sumar una unidad más: nextQty es la nueva cantidad a marcar.
  | { kind: 'increment'; item: T; nextQty: number; max: number }

/**
 * Resuelve un escaneo contra los ítems de la orden y las cantidades ya marcadas.
 * Cada escaneo del mismo producto suma una unidad, sin exceder lo comprado
 * (qty - qty_returned). No muta nada; la UI aplica el resultado.
 */
export function resolveReturnScan<T extends ScanReturnItem>(
  items: readonly T[],
  returnQtys: Record<string, number>,
  code: string,
): ReturnScanResolution<T> {
  const item = findByBarcode(items, code)
  if (!item) return { kind: 'not-found' }

  const max = item.qty - item.qty_returned
  if (max <= 0) return { kind: 'exhausted', item }

  const current = returnQtys[item.variant_id] ?? 0
  if (current >= max) return { kind: 'at-cap', item, max }

  return { kind: 'increment', item, nextQty: current + 1, max }
}
