// Informe de ventas por categoría × talla (planificación de compras, fase 0).
//
// Toda la definición de "venta neta", las equivalencias de categoría y la
// inferencia dama/hombre viven en SQL (migración 044, report_sales_by_category).
// La RPC ya devuelve filas agregadas por (tienda, categoría, talla): acá solo se
// les da forma para la pantalla y el Excel —sumar las tiendas en el
// consolidado, ordenar las tallas, calcular % y cobertura—. Puro y testeable.

export type CategorySource = 'category' | 'inferred' | 'none'

/** Una fila de report_sales_by_category (044). */
export interface SalesByCategoryRow {
  store_id: string
  store_name: string
  category_key: string
  category_label: string
  category_source: CategorySource
  from_transfer: boolean
  category_names: string[] | null
  size: string | null
  units_sold: number
  units_returned: number
  units_net: number
  gift_units: number
  amount_net: number | string
  stock_qty: number
  reserved_qty: number
  available_qty: number
}

export interface StoreRef {
  id: string
  name: string
}

/** Métricas que se suman igual por tienda, por talla y por categoría. */
export interface Metrics {
  unitsSold: number
  unitsReturned: number
  unitsNet: number
  giftUnits: number
  amountNet: number
  available: number
  reserved: number
}

export interface SizeLine extends Metrics {
  size: string | null
  /** Parte de las unidades netas de la categoría que vende esta talla (0..1). */
  share: number
  byStore: Record<string, Metrics>
}

export interface CategoryLine extends Metrics {
  /** Llave estable: category_key + si nació por traslado. */
  id: string
  categoryKey: string
  label: string
  source: CategorySource
  fromTransfer: boolean
  /** Nombres de categoría originales que se unieron en esta fila. */
  names: string[]
  /** Parte de las unidades netas del total (0..1). */
  share: number
  /** Plata neta por unidad neta; null si no hubo unidades. */
  pricePerUnit: number | null
  /** Días que alcanza el disponible al ritmo del período; null sin ventas. */
  coverageDays: number | null
  byStore: Record<string, Metrics>
  sizes: SizeLine[]
}

export interface CategoryReport {
  stores: StoreRef[]
  days: number
  categories: CategoryLine[]
  totals: Metrics
}

export function emptyMetrics(): Metrics {
  return { unitsSold: 0, unitsReturned: 0, unitsNet: 0, giftUnits: 0, amountNet: 0, available: 0, reserved: 0 }
}

function addRow(m: Metrics, r: SalesByCategoryRow): void {
  m.unitsSold += r.units_sold
  m.unitsReturned += r.units_returned
  m.unitsNet += r.units_net
  m.giftUnits += r.gift_units
  m.amountNet += Number(r.amount_net)
  m.available += r.available_qty
  m.reserved += r.reserved_qty
}

/** Días calendario del rango, ambos extremos incluidos (YYYY-MM-DD). */
export function daysInRange(dateFrom: string, dateTo: string): number {
  const a = Date.UTC(...ymd(dateFrom))
  const b = Date.UTC(...ymd(dateTo))
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1)
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m - 1, d]
}

/**
 * Cuántos días alcanza el disponible vendiendo al ritmo del período.
 * Sin ventas netas (o negativas, más devoluciones que ventas) → null: no hay
 * ritmo del que derivar nada, y "infinito" haría creer que sobra.
 */
export function coverageDays(available: number, unitsNet: number, days: number): number | null {
  if (unitsNet <= 0 || days <= 0) return null
  return Math.round(available / (unitsNet / days))
}

const LETTER_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL']

/** Orden de tallas: numéricas ascendente, luego letras (XS→XXXL), luego el resto. */
export function compareSizes(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const na = Number(a.replace(',', '.'))
  const nb = Number(b.replace(',', '.'))
  const aNum = a.trim() !== '' && Number.isFinite(na)
  const bNum = b.trim() !== '' && Number.isFinite(nb)
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  const la = LETTER_ORDER.indexOf(a.toUpperCase())
  const lb = LETTER_ORDER.indexOf(b.toUpperCase())
  if (la !== -1 && lb !== -1) return la - lb
  if (la !== -1) return -1
  if (lb !== -1) return 1
  return a.localeCompare(b, 'es')
}

const SOURCE_ORDER: Record<CategorySource, number> = { category: 0, inferred: 1, none: 2 }

/**
 * Arma el informe. Con UNA tienda en `rows` es el informe de esa tienda; con
 * varias, el consolidado: cada categoría y cada talla suman todas las tiendas
 * y `byStore` conserva el desglose para las columnas por tienda.
 */
export function buildCategoryReport(
  rows: SalesByCategoryRow[],
  dateFrom: string,
  dateTo: string,
): CategoryReport {
  const days = daysInRange(dateFrom, dateTo)
  const storeMap = new Map<string, string>()
  const catMap = new Map<string, {
    line: Omit<CategoryLine, 'sizes' | 'share' | 'pricePerUnit' | 'coverageDays'>
    names: Set<string>
    sizes: Map<string, Omit<SizeLine, 'share'>>
  }>()
  const totals = emptyMetrics()

  for (const r of rows) {
    storeMap.set(r.store_id, r.store_name)
    addRow(totals, r)

    const id = `${r.category_key}|${r.from_transfer ? 'traslado' : ''}`
    let cat = catMap.get(id)
    if (!cat) {
      cat = {
        line: {
          ...emptyMetrics(),
          id,
          categoryKey: r.category_key,
          label: r.category_label,
          source: r.category_source,
          fromTransfer: r.from_transfer,
          names: [],
          byStore: {},
        },
        names: new Set<string>(),
        sizes: new Map(),
      }
      catMap.set(id, cat)
    }
    addRow(cat.line, r)
    cat.line.byStore[r.store_id] ??= emptyMetrics()
    addRow(cat.line.byStore[r.store_id], r)
    for (const n of r.category_names ?? []) cat.names.add(n)

    const sizeKey = r.size ?? '\u0000'
    let size = cat.sizes.get(sizeKey)
    if (!size) {
      size = { ...emptyMetrics(), size: r.size, byStore: {} }
      cat.sizes.set(sizeKey, size)
    }
    addRow(size, r)
    size.byStore[r.store_id] ??= emptyMetrics()
    addRow(size.byStore[r.store_id], r)
  }

  // Los % se calculan sobre la suma de los netos POSITIVOS: si una categoría
  // devolvió más de lo que vendió en el período (neto < 0), no puede inflar el
  // % de las demás por encima del 100%.
  const positive = (n: number) => Math.max(0, n)
  const totalNet = [...catMap.values()].reduce((s, c) => s + positive(c.line.unitsNet), 0)
  const categories: CategoryLine[] = [...catMap.values()].map(({ line, names, sizes }) => {
    const catNet = [...sizes.values()].reduce((s, z) => s + positive(z.unitsNet), 0)
    return {
      ...line,
      names: [...names].sort((a, b) => a.localeCompare(b, 'es')),
      share: totalNet > 0 ? positive(line.unitsNet) / totalNet : 0,
      pricePerUnit: line.unitsNet > 0 ? line.amountNet / line.unitsNet : null,
      coverageDays: coverageDays(line.available, line.unitsNet, days),
      sizes: [...sizes.values()]
        .map((s) => ({ ...s, share: catNet > 0 ? positive(s.unitsNet) / catNet : 0 }))
        .sort((a, b) => compareSizes(a.size, b.size)),
    }
  })

  // Categorías reales primero (más vendida arriba); las inferidas y "sin
  // categoría" al final, para que no se confundan con una categoría de verdad.
  categories.sort(
    (a, b) =>
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      Number(a.fromTransfer) - Number(b.fromTransfer) ||
      b.unitsNet - a.unitsNet ||
      b.amountNet - a.amountNet ||
      a.label.localeCompare(b.label, 'es'),
  )

  const stores = [...storeMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return { stores, days, categories, totals }
}

/** Etiqueta para la pantalla y el Excel, con la marca de traslado si aplica. */
export function categoryDisplayLabel(line: Pick<CategoryLine, 'label' | 'fromTransfer'>): string {
  return line.fromTransfer ? `${line.label} · creado por traslado` : line.label
}

/** Texto de la talla: el NULL de la base es "Sin talla". */
export function sizeDisplayLabel(size: string | null): string {
  return size ?? 'Sin talla'
}
