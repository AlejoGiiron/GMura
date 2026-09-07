import type { TransferDestAction } from '@/types/database.types'
import type { TransferTarget } from '@/hooks/useTransfers'

// ─────────────────────────────────────────────────────────────────────────────
// Lógica pura de la pantalla de armar el envío (handoff §1.2, §4.1, §4.2).
// Sin React ni red: es lo que decide si el módulo llena de basura el catálogo
// del destino o no, así que va aislado y testeado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una línea del borrador, en el estado LOCAL de la pantalla.
 *
 * `destAction: null` es el estado "sin decidir" del handoff §0.1: existe solo
 * acá, NUNCA se manda al backend (`dest_action` no admite nulo). Al guardar con
 * líneas sin decidir la UI bloquea; descartarlas en silencio sería peor —
 * el usuario cree que guardó 6 productos y volvió con 4.
 */
export interface DraftLine {
  /** Estable mientras la línea vive: React la usa como key. */
  key: string
  fromVariantId: string
  // Snapshot local, para pintar sin ir al servidor. El snapshot REAL lo copia
  // save_transfer_draft desde la variante de origen.
  productName: string
  brand: string | null
  description: string | null
  size: string | null
  color: string | null
  unitPrice: number
  stockQty: number
  reservedQty: number
  qty: number
  destAction: TransferDestAction | null
  toProductId: string | null
  toVariantId: string | null
  /**
   * true si el usuario eligió el destino a mano (no lo preseleccionó §4.1).
   * Cambiar la tienda destino pide confirmación solo si hay alguna así.
   */
  manuallyChosen: boolean
}

/** Disponible real: lo apartado para separados es intocable (§0.2). */
export function availableOf(line: Pick<DraftLine, 'stockQty' | 'reservedQty'>): number {
  return Math.max(0, line.stockQty - line.reservedQty)
}

// ── Agrupar candidatos por FICHA ─────────────────────────────────────────────

/**
 * `search_transfer_targets` devuelve una fila por VARIANTE, pero la tarjeta de
 * candidato del diseño es por FICHA (muestra los chips de todas sus tallas y
 * colores). Esto agrupa.
 */
export interface CandidateProduct {
  productId: string
  productName: string
  brand: string | null
  description: string | null
  sizes: string[]
  colors: string[]
  /**
   * La variante de esta ficha que coincide en talla Y color con el origen, si
   * existe. Es lo que decide map_variant vs map_product (§1.2).
   *
   * Sale de `match_kind === 'exact_variant'`, que lo calcula la BD con la misma
   * normalización que usa la recepción. NO se recalcula acá: duplicar esa
   * lógica en el cliente es pedir que se desincronicen.
   */
  exactVariantId: string | null
}

export function groupCandidates(rows: TransferTarget[]): CandidateProduct[] {
  const byProduct = new Map<string, CandidateProduct>()

  for (const r of rows) {
    let p = byProduct.get(r.product_id)
    if (!p) {
      p = {
        productId: r.product_id,
        productName: r.product_name,
        brand: r.brand,
        description: r.description,
        sizes: [],
        colors: [],
        exactVariantId: null,
      }
      byProduct.set(r.product_id, p)
    }
    if (r.size && !p.sizes.includes(r.size)) p.sizes.push(r.size)
    if (r.color && !p.colors.includes(r.color)) p.colors.push(r.color)
    if (r.match_kind === 'exact_variant') p.exactVariantId = r.variant_id
  }

  // Las fichas con coincidencia exacta primero: es el orden en que conviene
  // leerlas, y `search_transfer_targets` ya devuelve las filas rankeadas.
  return [...byProduct.values()].sort(
    (a, b) => Number(!!b.exactVariantId) - Number(!!a.exactVariantId),
  )
}

/** Comparación SOLO para pintar los chips en verde. Cosmética. */
export function sameLabel(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) =>
    (s ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
  return norm(a) === norm(b) && norm(a) !== ''
}

// ── §4.1 Qué pasa al agregar una línea ───────────────────────────────────────

export interface InitialDestination {
  destAction: TransferDestAction | null
  toProductId: string | null
  toVariantId: string | null
  /** true = la línea se abre sola en el selector; false = queda colapsada. */
  open: boolean
}

/**
 * Handoff §4.1 — la regla que decide si el usuario tiene que hacer clic.
 *
 * El caso que importa: si hay VARIOS candidatos exactos (pasa cuando el destino
 * tiene dos fichas con la misma talla y color y distinta marca), NO se
 * preselecciona ninguno y la línea se abre. Adivinar ahí es exactamente cómo se
 * generan los duplicados que este módulo intenta no multiplicar.
 */
export function resolveInitialDestination(
  candidates: CandidateProduct[],
  canCreateProducts: boolean,
): InitialDestination {
  const exactos = candidates.filter((c) => c.exactVariantId)

  // Un solo candidato exacto → preseleccionado y colapsado. Cero clics.
  if (exactos.length === 1) {
    return {
      destAction: 'map_variant',
      toProductId: exactos[0].productId,
      toVariantId: exactos[0].exactVariantId,
      open: false,
    }
  }

  // Varios exactos → no se adivina.
  if (exactos.length > 1) {
    return { destAction: null, toProductId: null, toVariantId: null, open: true }
  }

  // Hay candidatos pero ninguno exacto → la decisión no se puede postergar
  // sin darse cuenta.
  if (candidates.length > 0) {
    return { destAction: null, toProductId: null, toVariantId: null, open: true }
  }

  // Sin candidatos: si puede crear, no hay nada que elegir.
  if (canCreateProducts) {
    return { destAction: 'create_product', toProductId: null, toVariantId: null, open: false }
  }

  // Sin candidatos y sin permiso: la línea queda bloqueada, con la explicación.
  return { destAction: null, toProductId: null, toVariantId: null, open: true }
}

/** Elegir una ficha candidata deriva el dest_action (§1.2). */
export function destinationFromCandidate(c: CandidateProduct): {
  destAction: TransferDestAction
  toProductId: string | null
  toVariantId: string | null
} {
  return c.exactVariantId
    ? { destAction: 'map_variant', toProductId: c.productId, toVariantId: c.exactVariantId }
    : { destAction: 'map_product', toProductId: c.productId, toVariantId: null }
}

// ── Resumen del rail ─────────────────────────────────────────────────────────

export interface BuilderSummary {
  products: number
  units: number
  value: number
  exact: number
  newSize: number
  newProduct: number
  undecided: number
}

export function summarize(lines: DraftLine[]): BuilderSummary {
  const s: BuilderSummary = {
    products: lines.length,
    units: 0,
    value: 0,
    exact: 0,
    newSize: 0,
    newProduct: 0,
    undecided: 0,
  }
  for (const l of lines) {
    s.units += l.qty
    s.value += l.qty * l.unitPrice
    if (l.destAction === 'map_variant') s.exact++
    else if (l.destAction === 'map_product') s.newSize++
    else if (l.destAction === 'create_product') s.newProduct++
    else s.undecided++
  }
  return s
}

/** Índice de la primera línea sin decidir, o -1. Para "Ir a la primera…". */
export function firstUndecided(lines: DraftLine[]): number {
  return lines.findIndex((l) => l.destAction === null)
}

// ── Payload para save_transfer_draft ─────────────────────────────────────────

export interface TransferItemPayload {
  from_variant_id: string
  qty: number
  dest_action: TransferDestAction
  to_product_id: string | null
  to_variant_id: string | null
}

/**
 * Traduce el estado local al payload de la RPC.
 *
 * Lanza si hay líneas sin decidir: es un error de programación, no de usuario
 * (la UI bloquea antes, con el mensaje de §5.2). El throw existe para que un
 * camino nuevo no cuele `dest_action: null` al backend en silencio.
 */
export function buildItemsPayload(lines: DraftLine[]): TransferItemPayload[] {
  return lines.map((l) => {
    if (l.destAction === null) {
      throw new Error('Hay líneas sin destino: no se puede armar el payload')
    }
    return {
      from_variant_id: l.fromVariantId,
      qty: l.qty,
      dest_action: l.destAction,
      // map_variant lleva la variante; map_product la ficha; create_product nada.
      to_product_id: l.destAction === 'map_product' ? l.toProductId : null,
      to_variant_id: l.destAction === 'map_variant' ? l.toVariantId : null,
    }
  })
}
