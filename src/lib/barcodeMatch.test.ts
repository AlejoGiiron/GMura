import { describe, it, expect } from 'vitest'
import { findByBarcode, resolveReturnScan, type ScanReturnItem } from './barcodeMatch'

describe('findByBarcode', () => {
  const items = [
    { barcode: '111', name: 'a' },
    { barcode: '222', name: 'b' },
    { barcode: null, name: 'sin código' },
  ]

  it('devuelve el ítem con match exacto', () => {
    expect(findByBarcode(items, '222')?.name).toBe('b')
  })

  it('devuelve null si no hay coincidencia', () => {
    expect(findByBarcode(items, '999')).toBeNull()
  })

  it('devuelve null con código vacío o solo espacios', () => {
    expect(findByBarcode(items, '')).toBeNull()
    expect(findByBarcode(items, '   ')).toBeNull()
  })

  it('recorta espacios del código escaneado', () => {
    expect(findByBarcode(items, '  111  ')?.name).toBe('a')
  })

  it('ignora ítems con barcode null (no matchea contra código vacío)', () => {
    expect(findByBarcode(items, 'null')).toBeNull()
  })
})

describe('resolveReturnScan', () => {
  const items: (ScanReturnItem & { product_name: string })[] = [
    { variant_id: 'v1', barcode: '111', qty: 2, qty_returned: 0, product_name: 'Camisa' },
    { variant_id: 'v2', barcode: '222', qty: 1, qty_returned: 1, product_name: 'Pantalón' },
  ]

  it('código fuera de la orden → not-found', () => {
    const r = resolveReturnScan(items, {}, '999')
    expect(r.kind).toBe('not-found')
  })

  it('primer escaneo suma 1 unidad', () => {
    const r = resolveReturnScan(items, {}, '111')
    expect(r).toMatchObject({ kind: 'increment', nextQty: 1, max: 2 })
  })

  it('escaneo repetido suma otra unidad', () => {
    const r = resolveReturnScan(items, { v1: 1 }, '111')
    expect(r).toMatchObject({ kind: 'increment', nextQty: 2 })
  })

  it('no excede lo comprado (comprados 2, ya marcados 2) → at-cap', () => {
    const r = resolveReturnScan(items, { v1: 2 }, '111')
    expect(r).toMatchObject({ kind: 'at-cap', max: 2 })
  })

  it('ítem ya devuelto por completo → exhausted', () => {
    const r = resolveReturnScan(items, {}, '222')
    expect(r.kind).toBe('exhausted')
  })

  it('respeta qty_returned previo al calcular el máximo', () => {
    const parcial: ScanReturnItem[] = [
      { variant_id: 'v3', barcode: '333', qty: 3, qty_returned: 1 },
    ]
    // max = 3 - 1 = 2; con 2 ya marcados → at-cap
    expect(resolveReturnScan(parcial, { v3: 2 }, '333').kind).toBe('at-cap')
    expect(resolveReturnScan(parcial, { v3: 1 }, '333')).toMatchObject({
      kind: 'increment',
      nextQty: 2,
      max: 2,
    })
  })
})
