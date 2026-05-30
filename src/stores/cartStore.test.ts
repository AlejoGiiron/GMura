import { describe, it, expect } from 'vitest'
import { cartTotals, type CartItem, type Discount } from './cartStore'

function item(
  fields: Partial<CartItem> & { unit_price: number; qty: number },
): CartItem {
  return {
    variant_id: fields.variant_id ?? 'v1',
    product_id: fields.product_id ?? 'p1',
    name: fields.name ?? 'Producto',
    brand: fields.brand ?? null,
    size: fields.size ?? null,
    color: fields.color ?? null,
    unit_price: fields.unit_price,
    qty: fields.qty,
    stock_qty: fields.stock_qty ?? 99,
  }
}

const sinDescuento: Discount = { value: 0 }

describe('cartTotals', () => {
  it('carrito vacío devuelve subtotal, descuento y total en 0', () => {
    expect(cartTotals([], sinDescuento)).toEqual({
      subtotal: 0,
      discountAmt: 0,
      total: 0,
    })
  })

  it('un ítem con cantidad 2 a $10.000 da subtotal $20.000', () => {
    const items = [item({ unit_price: 10_000, qty: 2 })]
    const { subtotal, discountAmt, total } = cartTotals(items, sinDescuento)
    expect(subtotal).toBe(20_000)
    expect(discountAmt).toBe(0)
    expect(total).toBe(20_000)
  })

  it('suma correctamente varios ítems', () => {
    const items = [
      item({ variant_id: 'a', unit_price: 15_000, qty: 1 }),
      item({ variant_id: 'b', unit_price: 25_000, qty: 2 }),
      item({ variant_id: 'c', unit_price: 5_000, qty: 3 }),
    ]
    // 15.000 + 50.000 + 15.000 = 80.000
    expect(cartTotals(items, sinDescuento).subtotal).toBe(80_000)
    expect(cartTotals(items, sinDescuento).total).toBe(80_000)
  })

  it('aplica un descuento fijo: total = subtotal - descuento', () => {
    const items = [item({ unit_price: 50_000, qty: 2 })] // 100.000
    const { subtotal, discountAmt, total } = cartTotals(items, { value: 15_000 })
    expect(subtotal).toBe(100_000)
    expect(discountAmt).toBe(15_000)
    expect(total).toBe(85_000)
  })

  it('un descuento mayor al subtotal no deja el total por debajo de 0 (clamp)', () => {
    const items = [item({ unit_price: 20_000, qty: 1 })] // 20.000
    const { subtotal, discountAmt, total } = cartTotals(items, { value: 50_000 })
    expect(subtotal).toBe(20_000)
    expect(discountAmt).toBe(20_000) // descuento limitado al subtotal
    expect(total).toBe(0)
  })

  it('un descuento negativo se trata como 0', () => {
    const items = [item({ unit_price: 30_000, qty: 1 })]
    const { discountAmt, total } = cartTotals(items, { value: -5_000 })
    expect(discountAmt).toBe(0)
    expect(total).toBe(30_000)
  })

  it('calcula bien precios con decimales', () => {
    const items = [
      item({ variant_id: 'a', unit_price: 1_500.5, qty: 2 }), // 3.001
      item({ variant_id: 'b', unit_price: 999.99, qty: 3 }), // 2.999,97
    ]
    expect(cartTotals(items, sinDescuento).subtotal).toBeCloseTo(6_000.97, 2)
  })
})
