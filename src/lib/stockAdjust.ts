// Ajuste manual de stock (migración 045, RPC adjust_variant_stock).
//
// La RPC recibe un DELTA, nunca un valor absoluto: un absoluto ("dejá 12")
// calculado sobre lo que mostraba la pantalla pisa las ventas que pasaron
// mientras tanto. Acá se traduce lo que el usuario escribe a ese delta:
//   · 'delta' (sumar o restar): "llegaron 3" → +3, "se dañó 1" → −1
//   · 'count' (conteo físico):  "conté 12"   → 12 − stock mostrado, y se manda
//     el stock mostrado como expectedQty: si cambió, la RPC rechaza en vez de
//     pisar la venta.
// Puro y testeable; la validación final la hace la RPC (stock real + FOR UPDATE).

export type AdjustMode = 'delta' | 'count'

export interface AdjustInput {
  mode: AdjustMode
  /** Lo que el usuario tipeó en el campo de cantidad. */
  qtyInput: string
  /** Stock físico que muestra la pantalla. */
  current: number
  /** Unidades apartadas en separados activos. */
  reserved: number
}

export interface AdjustComputation {
  delta: number | null
  resulting: number | null
  /** Solo en conteo: el stock sobre el que se calculó el delta. */
  expectedQty: number | null
  /** Mensaje para el usuario si no se puede confirmar; null si está ok. */
  error: string | null
}

export function computeAdjustment({ mode, qtyInput, current, reserved }: AdjustInput): AdjustComputation {
  const raw = qtyInput.trim()
  const empty = { delta: null, resulting: null, expectedQty: null }
  if (raw === '') return { ...empty, error: null }
  if (!/^[+-]?\d+$/.test(raw)) return { ...empty, error: 'Escribí un número entero' }

  const n = Number(raw)
  let delta: number
  let expectedQty: number | null = null

  if (mode === 'count') {
    if (n < 0) return { ...empty, error: 'El conteo no puede ser negativo' }
    delta = n - current
    expectedQty = current
    if (delta === 0) {
      return { delta: 0, resulting: current, expectedQty, error: 'El conteo coincide con el stock: no hay nada que ajustar' }
    }
  } else {
    delta = n
    if (delta === 0) return { delta: 0, resulting: current, expectedQty: null, error: 'La cantidad tiene que ser distinta de 0' }
  }

  const resulting = current + delta
  if (resulting < 0) {
    return { delta, resulting, expectedQty, error: `Quedaría en negativo (hay ${current})` }
  }
  if (resulting < reserved) {
    return {
      delta,
      resulting,
      expectedQty,
      error: `No puede quedar menos de lo apartado en separados (${reserved} reservadas)`,
    }
  }
  return { delta, resulting, expectedQty, error: null }
}

/**
 * Motivo que se guarda en el movimiento: "[Tipo] detalle". "Otro" o sin tipo
 * va solo el detalle. Mismo formato que ya usaba Inventario.
 */
export function buildAdjustReason(tipo: string, detalle: string): string {
  const d = detalle.trim()
  const t = tipo.trim()
  if (!t || t.toLowerCase() === 'otro') return d
  return d ? `[${t}] ${d}` : `[${t}]`
}

/** El motivo es obligatorio: el detalle escrito por la persona, no solo el tipo. */
export function isValidAdjustDetail(detalle: string): boolean {
  return detalle.trim().length >= 3
}
