import { describe, it, expect } from 'vitest'
import {
  buildCategoryReport,
  categoryDisplayLabel,
  compareSizes,
  coverageDays,
  daysInRange,
  sizeDisplayLabel,
  type SalesByCategoryRow,
} from './categoryReport'

const TEB = { id: 'teb', name: 'La bodega del Jeans - Tebaida' }
const ARM = { id: 'arm', name: 'LA BODEGA DEL JEANS - ARMENIA' }

function row(over: Partial<SalesByCategoryRow>): SalesByCategoryRow {
  return {
    store_id: TEB.id,
    store_name: TEB.name,
    category_key: 'PANTALON DAMA',
    category_label: 'PANTALON DAMA',
    category_source: 'category',
    from_transfer: false,
    category_names: ['PANTALON DAMA'],
    size: '10',
    units_sold: 0,
    units_returned: 0,
    units_net: 0,
    gift_units: 0,
    amount_net: 0,
    stock_qty: 0,
    reserved_qty: 0,
    available_qty: 0,
    ...over,
  }
}

describe('daysInRange', () => {
  it('cuenta los dos extremos', () => {
    expect(daysInRange('2026-09-01', '2026-09-30')).toBe(30)
    expect(daysInRange('2026-10-05', '2026-10-05')).toBe(1)
  })

  it('cruza meses y años', () => {
    expect(daysInRange('2025-12-14', '2026-03-13')).toBe(90)
  })
})

describe('coverageDays', () => {
  it('días que alcanza el disponible al ritmo del período', () => {
    // 90 vendidas en 90 días = 1/día; 30 disponibles → 30 días
    expect(coverageDays(30, 90, 90)).toBe(30)
  })

  it('sin ventas netas no hay ritmo: null (no "infinito")', () => {
    expect(coverageDays(30, 0, 90)).toBeNull()
    expect(coverageDays(30, -2, 90)).toBeNull()
  })

  it('sin disponible: 0 días', () => {
    expect(coverageDays(0, 10, 30)).toBe(0)
  })
})

describe('compareSizes', () => {
  it('numéricas ascendente (no alfabético: 6 antes que 10)', () => {
    expect(['10', '6', '22', '8'].sort(compareSizes)).toEqual(['6', '8', '10', '22'])
  })

  it('letras en orden de talla, después de las numéricas', () => {
    expect(['XL', 'S', '28', 'M', 'XS', 'L'].sort(compareSizes)).toEqual(['28', 'XS', 'S', 'M', 'L', 'XL'])
  })

  it('el resto alfabético y "sin talla" (null) al final', () => {
    expect([null, 'UNICA', 'M', '30'].sort(compareSizes)).toEqual(['30', 'M', 'UNICA', null])
  })
})

describe('buildCategoryReport — una tienda', () => {
  const rows = [
    row({ size: '10', units_sold: 5, units_returned: 1, units_net: 4, amount_net: 356000, available_qty: 8, stock_qty: 9, reserved_qty: 1 }),
    row({ size: '8', units_sold: 4, units_net: 4, amount_net: 356000, available_qty: 0 }),
    row({ category_key: 'BLUSA', category_label: 'BLUSA', category_names: ['BLUSA'], size: 'M', units_sold: 2, units_net: 2, gift_units: 1, amount_net: 46000, available_qty: 3 }),
  ]
  const r = buildCategoryReport(rows, '2026-09-01', '2026-09-30')

  it('suma la categoría desde sus tallas', () => {
    const dama = r.categories.find((c) => c.categoryKey === 'PANTALON DAMA')!
    expect(dama.unitsSold).toBe(9)
    expect(dama.unitsReturned).toBe(1)
    expect(dama.unitsNet).toBe(8)
    expect(dama.amountNet).toBe(712000)
    expect(dama.available).toBe(8)
    expect(dama.reserved).toBe(1)
  })

  it('ordena por unidades netas y calcula el % del total', () => {
    expect(r.categories.map((c) => c.categoryKey)).toEqual(['PANTALON DAMA', 'BLUSA'])
    expect(r.categories[0].share).toBeCloseTo(8 / 10)
    expect(r.totals.unitsNet).toBe(10)
  })

  it('curva de tallas ordenada y con la parte de cada talla', () => {
    const dama = r.categories[0]
    expect(dama.sizes.map((s) => s.size)).toEqual(['8', '10'])
    expect(dama.sizes.map((s) => s.share)).toEqual([0.5, 0.5])
  })

  it('precio por unidad y cobertura', () => {
    const dama = r.categories[0]
    expect(dama.pricePerUnit).toBe(89000)
    // 8 netas en 30 días; 8 disponibles → 30 días
    expect(dama.coverageDays).toBe(30)
  })

  it('el regalo queda contado en unidades', () => {
    const blusa = r.categories[1]
    expect(blusa.giftUnits).toBe(1)
    expect(blusa.unitsNet).toBe(2)
  })

  it('amount_net llega como string desde PostgREST (numeric) y se suma igual', () => {
    const r2 = buildCategoryReport([row({ units_net: 1, amount_net: '89000.00' })], '2026-09-01', '2026-09-30')
    expect(r2.totals.amountNet).toBe(89000)
  })
})

describe('buildCategoryReport — consolidado', () => {
  const rows = [
    row({ store_id: TEB.id, store_name: TEB.name, size: '10', units_net: 3, units_sold: 3, amount_net: 267000, available_qty: 5 }),
    row({ store_id: ARM.id, store_name: ARM.name, size: '10', units_net: 7, units_sold: 7, amount_net: 623000, available_qty: 2 }),
    // BLUSA (Tebaida) y BLUSAS (Armenia) ya vienen con la MISMA llave desde SQL
    row({ store_id: TEB.id, store_name: TEB.name, category_key: 'BLUSA', category_label: 'BLUSA', category_names: ['BLUSA'], size: 'M', units_net: 1, amount_net: 46000 }),
    row({ store_id: ARM.id, store_name: ARM.name, category_key: 'BLUSA', category_label: 'BLUSA', category_names: ['BLUSAS'], size: 'M', units_net: 2, amount_net: 92000 }),
  ]
  const r = buildCategoryReport(rows, '2026-09-01', '2026-09-30')

  it('lista las tiendas ordenadas por nombre', () => {
    expect(r.stores.map((s) => s.id)).toEqual(['arm', 'teb'])
  })

  it('suma las tiendas por categoría y conserva el desglose por tienda', () => {
    const dama = r.categories.find((c) => c.categoryKey === 'PANTALON DAMA')!
    expect(dama.unitsNet).toBe(10)
    expect(dama.byStore.teb.unitsNet).toBe(3)
    expect(dama.byStore.arm.unitsNet).toBe(7)
    expect(dama.available).toBe(7)
  })

  it('la talla también se suma entre tiendas, con su desglose', () => {
    const t10 = r.categories.find((c) => c.categoryKey === 'PANTALON DAMA')!.sizes[0]
    expect(t10.unitsNet).toBe(10)
    expect(t10.byStore.arm.unitsNet).toBe(7)
  })

  it('una categoría unida muestra los nombres originales de cada tienda', () => {
    const blusa = r.categories.find((c) => c.categoryKey === 'BLUSA')!
    expect(blusa.names).toEqual(['BLUSA', 'BLUSAS'])
    expect(blusa.unitsNet).toBe(3)
  })
})

describe('buildCategoryReport — sin categoría', () => {
  const rows = [
    row({ category_key: '~SIN CATEGORIA', category_label: 'SIN CATEGORÍA', category_source: 'none', category_names: [], units_net: 9, size: null }),
    row({ category_key: '~INFERIDO DAMA', category_label: 'DAMA (INFERIDO)', category_source: 'inferred', category_names: [], units_net: 4 }),
    row({ category_key: '~INFERIDO DAMA', category_label: 'DAMA (INFERIDO)', category_source: 'inferred', from_transfer: true, category_names: [], units_net: 6 }),
    row({ units_net: 1 }),
  ]
  const r = buildCategoryReport(rows, '2026-09-01', '2026-09-30')

  it('van al final aunque vendan más: no se confunden con una categoría real', () => {
    expect(r.categories.map((c) => c.source)).toEqual(['category', 'inferred', 'inferred', 'none'])
  })

  it('lo creado por traslado es una fila aparte', () => {
    const inferidas = r.categories.filter((c) => c.categoryKey === '~INFERIDO DAMA')
    expect(inferidas).toHaveLength(2)
    expect(inferidas.map((c) => categoryDisplayLabel(c))).toEqual([
      'DAMA (INFERIDO)',
      'DAMA (INFERIDO) · creado por traslado',
    ])
  })

  it('la talla NULL se muestra como "Sin talla"', () => {
    expect(sizeDisplayLabel(r.categories[3].sizes[0].size)).toBe('Sin talla')
  })
})

describe('buildCategoryReport — bordes', () => {
  it('sin filas: informe vacío sin dividir por cero', () => {
    const r = buildCategoryReport([], '2026-09-01', '2026-09-30')
    expect(r.categories).toEqual([])
    expect(r.totals.unitsNet).toBe(0)
  })

  it('stock sin ventas: la categoría aparece, sin precio ni cobertura', () => {
    const r = buildCategoryReport([row({ available_qty: 12 })], '2026-09-01', '2026-09-30')
    expect(r.categories[0].available).toBe(12)
    expect(r.categories[0].pricePerUnit).toBeNull()
    expect(r.categories[0].coverageDays).toBeNull()
    expect(r.categories[0].share).toBe(0)
  })

  it('más devoluciones que ventas: neto negativo, % en 0', () => {
    const r = buildCategoryReport(
      [row({ units_returned: 2, units_net: -2, amount_net: -178000 }), row({ category_key: 'BLUSA', category_label: 'BLUSA', size: 'M', units_net: 4 })],
      '2026-09-01', '2026-09-30',
    )
    const dama = r.categories.find((c) => c.categoryKey === 'PANTALON DAMA')!
    const blusa = r.categories.find((c) => c.categoryKey === 'BLUSA')!
    expect(dama.unitsNet).toBe(-2)
    expect(dama.share).toBe(0)
    // El neto negativo no infla a las demás por encima del 100%.
    expect(blusa.share).toBe(1)
  })
})
