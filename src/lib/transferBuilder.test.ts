import { describe, it, expect } from 'vitest'
import {
  availableOf,
  buildItemsPayload,
  destinationFromCandidate,
  firstUndecided,
  groupCandidates,
  resolveInitialDestination,
  summarize,
  type CandidateProduct,
  type DraftLine,
} from './transferBuilder'
import type { TransferTarget } from '@/hooks/useTransfers'

const target = (o: Partial<TransferTarget>): TransferTarget => ({
  product_id: 'p1',
  product_name: 'JEAN',
  brand: 'DIVA',
  description: 'CLASICO',
  variant_id: 'v1',
  size: 'T.30',
  color: 'AZUL',
  price: 89000,
  stock_qty: 3,
  is_active: true,
  match_kind: 'same_product',
  ...o,
})

const line = (o: Partial<DraftLine> = {}): DraftLine => ({
  key: 'k1',
  fromVariantId: 'fv1',
  productName: 'JEAN',
  brand: 'DIVA',
  description: 'CLASICO',
  size: 'T.30',
  color: 'AZUL',
  unitPrice: 89000,
  stockQty: 10,
  reservedQty: 0,
  qty: 1,
  destAction: 'map_variant',
  toProductId: 'p1',
  toVariantId: 'v1',
  manuallyChosen: false,
  ...o,
})

describe('availableOf', () => {
  it('descuenta lo apartado para separados', () => {
    expect(availableOf({ stockQty: 6, reservedQty: 2 })).toBe(4)
  })

  it('nunca es negativo aunque el reservado supere el stock', () => {
    expect(availableOf({ stockQty: 1, reservedQty: 5 })).toBe(0)
  })
})

describe('groupCandidates', () => {
  it('agrupa las filas por FICHA juntando tallas y colores', () => {
    const g = groupCandidates([
      target({ variant_id: 'v1', size: 'S', color: 'BLANCO' }),
      target({ variant_id: 'v2', size: 'M', color: 'BLANCO' }),
      target({ variant_id: 'v3', size: 'M', color: 'NEGRO' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].sizes).toEqual(['S', 'M'])
    expect(g[0].colors).toEqual(['BLANCO', 'NEGRO'])
  })

  it('marca la variante exacta según el match_kind que calcula la BD', () => {
    const g = groupCandidates([
      target({ variant_id: 'v1', size: 'S', match_kind: 'same_product' }),
      target({ variant_id: 'v2', size: 'T.30', match_kind: 'exact_variant' }),
    ])
    expect(g[0].exactVariantId).toBe('v2')
  })

  it('sin coincidencia exacta deja exactVariantId en null', () => {
    const g = groupCandidates([target({ match_kind: 'same_product' })])
    expect(g[0].exactVariantId).toBeNull()
  })

  it('pone primero las fichas con coincidencia exacta', () => {
    const g = groupCandidates([
      target({ product_id: 'pA', variant_id: 'vA', match_kind: 'name_similar' }),
      target({ product_id: 'pB', variant_id: 'vB', match_kind: 'exact_variant' }),
    ])
    expect(g[0].productId).toBe('pB')
  })
})

describe('resolveInitialDestination (§4.1)', () => {
  const exacto = (id: string): CandidateProduct => ({
    productId: `p-${id}`,
    productName: 'JEAN',
    brand: 'DIVA',
    description: null,
    sizes: ['T.30'],
    colors: ['AZUL'],
    exactVariantId: `v-${id}`,
  })
  const parecido = (id: string): CandidateProduct => ({ ...exacto(id), exactVariantId: null })

  it('UN candidato exacto → preseleccionado y COLAPSADO (cero clics)', () => {
    const r = resolveInitialDestination([exacto('1')], true)
    expect(r.destAction).toBe('map_variant')
    expect(r.toVariantId).toBe('v-1')
    expect(r.open).toBe(false)
  })

  it('VARIOS candidatos exactos → NO adivina y abre la línea', () => {
    // Es exactamente cómo se generan los duplicados: dos fichas del destino con
    // la misma talla y color y distinta marca.
    const r = resolveInitialDestination([exacto('1'), exacto('2')], true)
    expect(r.destAction).toBeNull()
    expect(r.open).toBe(true)
  })

  it('hay candidatos pero ninguno exacto → sin decidir y abierta', () => {
    const r = resolveInitialDestination([parecido('1')], true)
    expect(r.destAction).toBeNull()
    expect(r.open).toBe(true)
  })

  it('sin candidatos y CON permiso → create_product colapsado', () => {
    const r = resolveInitialDestination([], true)
    expect(r.destAction).toBe('create_product')
    expect(r.open).toBe(false)
  })

  it('sin candidatos y SIN permiso → bloqueada y abierta con la explicación', () => {
    const r = resolveInitialDestination([], false)
    expect(r.destAction).toBeNull()
    expect(r.open).toBe(true)
  })
})

describe('destinationFromCandidate (§1.2)', () => {
  const base: CandidateProduct = {
    productId: 'p1',
    productName: 'JEAN',
    brand: null,
    description: null,
    sizes: [],
    colors: [],
    exactVariantId: null,
  }

  it('la ficha tiene esa talla y color → map_variant con to_variant_id', () => {
    const d = destinationFromCandidate({ ...base, exactVariantId: 'v9' })
    expect(d).toEqual({ destAction: 'map_variant', toProductId: 'p1', toVariantId: 'v9' })
  })

  it('la ficha existe pero le falta la talla/color → map_product', () => {
    const d = destinationFromCandidate(base)
    expect(d).toEqual({ destAction: 'map_product', toProductId: 'p1', toVariantId: null })
  })
})

describe('summarize y firstUndecided', () => {
  it('cuenta unidades, valor y cada tipo de mapeo', () => {
    const s = summarize([
      line({ key: 'a', qty: 2, destAction: 'map_variant' }),
      line({ key: 'b', qty: 1, destAction: 'map_product' }),
      line({ key: 'c', qty: 3, destAction: 'create_product' }),
      line({ key: 'd', qty: 1, destAction: null }),
    ])
    expect(s.products).toBe(4)
    expect(s.units).toBe(7)
    expect(s.value).toBe(7 * 89000)
    expect(s).toMatchObject({ exact: 1, newSize: 1, newProduct: 1, undecided: 1 })
  })

  it('encuentra la primera línea sin decidir', () => {
    expect(
      firstUndecided([line({ key: 'a' }), line({ key: 'b', destAction: null })]),
    ).toBe(1)
  })

  it('devuelve -1 cuando están todas resueltas', () => {
    expect(firstUndecided([line()])).toBe(-1)
  })
})

describe('buildItemsPayload', () => {
  it('map_variant manda solo to_variant_id', () => {
    const [p] = buildItemsPayload([line({ destAction: 'map_variant' })])
    expect(p).toMatchObject({ dest_action: 'map_variant', to_variant_id: 'v1', to_product_id: null })
  })

  it('map_product manda solo to_product_id', () => {
    const [p] = buildItemsPayload([line({ destAction: 'map_product' })])
    expect(p).toMatchObject({ dest_action: 'map_product', to_product_id: 'p1', to_variant_id: null })
  })

  it('create_product no manda ninguno de los dos', () => {
    const [p] = buildItemsPayload([line({ destAction: 'create_product' })])
    expect(p).toMatchObject({ to_product_id: null, to_variant_id: null })
  })

  it('LANZA si queda una línea sin decidir: dest_action null no puede llegar al backend', () => {
    expect(() => buildItemsPayload([line({ destAction: null })])).toThrow(/sin destino/)
  })
})
