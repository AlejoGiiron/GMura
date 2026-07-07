import { describe, it, expect } from 'vitest'
import {
  addExchangeLine,
  setExchangeLineQty,
  removeExchangeLine,
  isAtStockCap,
  type ExchangeCandidate,
  type ExchangeLine,
} from './exchangeCart'

function candidate(over: Partial<ExchangeCandidate> = {}): ExchangeCandidate {
  return {
    id: 'v1',
    product_id: 'p1',
    product_name: 'Jean',
    size: '32',
    color: 'Azul',
    price: 100_000,
    stock_qty: 5,
    sku: 'SKU-1',
    ...over,
  }
}

describe('addExchangeLine', () => {
  it('agrega una variante nueva con qty 1 y sus datos de display', () => {
    const list = addExchangeLine([], candidate())
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      variant_id: 'v1',
      product_id: 'p1',
      qty: 1,
      list_price: 100_000,
      stock_qty: 5,
      product_name: 'Jean',
    })
  })

  it('agregar la MISMA variante incrementa la qty (no duplica línea)', () => {
    let list: ExchangeLine[] = addExchangeLine([], candidate())
    list = addExchangeLine(list, candidate())
    expect(list).toHaveLength(1)
    expect(list[0].qty).toBe(2)
  })

  it('permite VARIAS variantes distintas (varios productos nuevos)', () => {
    let list = addExchangeLine([], candidate({ id: 'v1' }))
    list = addExchangeLine(list, candidate({ id: 'v2', product_name: 'Camisa' }))
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.variant_id)).toEqual(['v1', 'v2'])
  })

  it('no incrementa más allá del stock', () => {
    let list = addExchangeLine([], candidate({ stock_qty: 2 }))
    list = addExchangeLine(list, candidate({ stock_qty: 2 }))
    const before = list
    list = addExchangeLine(list, candidate({ stock_qty: 2 })) // 3er intento
    expect(list[0].qty).toBe(2)
    expect(list).toBe(before) // misma referencia: no hubo cambio
  })
})

describe('isAtStockCap', () => {
  it('true cuando la variante alcanzó su stock', () => {
    const list = setExchangeLineQty(addExchangeLine([], candidate({ stock_qty: 1 })), 'v1', 1)
    expect(isAtStockCap(list, candidate({ stock_qty: 1 }))).toBe(true)
  })
  it('false cuando aún cabe o no está en la lista', () => {
    expect(isAtStockCap([], candidate())).toBe(false)
    const list = addExchangeLine([], candidate({ stock_qty: 5 }))
    expect(isAtStockCap(list, candidate({ stock_qty: 5 }))).toBe(false)
  })
})

describe('setExchangeLineQty', () => {
  it('clampa al stock máximo', () => {
    const list = setExchangeLineQty(addExchangeLine([], candidate({ stock_qty: 3 })), 'v1', 99)
    expect(list[0].qty).toBe(3)
  })
  it('mínimo 1 (no permite 0 ni negativos)', () => {
    const list = setExchangeLineQty(addExchangeLine([], candidate()), 'v1', 0)
    expect(list[0].qty).toBe(1)
  })
  it('no toca otras líneas', () => {
    let list = addExchangeLine([], candidate({ id: 'v1' }))
    list = addExchangeLine(list, candidate({ id: 'v2', stock_qty: 9 }))
    list = setExchangeLineQty(list, 'v2', 4)
    expect(list.find((e) => e.variant_id === 'v1')?.qty).toBe(1)
    expect(list.find((e) => e.variant_id === 'v2')?.qty).toBe(4)
  })
})

describe('removeExchangeLine', () => {
  it('quita la variante indicada', () => {
    let list = addExchangeLine([], candidate({ id: 'v1' }))
    list = addExchangeLine(list, candidate({ id: 'v2' }))
    list = removeExchangeLine(list, 'v1')
    expect(list).toHaveLength(1)
    expect(list[0].variant_id).toBe('v2')
  })
})
