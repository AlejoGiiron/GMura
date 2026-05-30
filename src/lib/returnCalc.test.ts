import { describe, it, expect } from 'vitest'
import { calculateExchangeAmounts, sumLines, type ReturnLine } from './returnCalc'

function line(unit_price: number, qty = 1): ReturnLine {
  return { unit_price, qty }
}

describe('sumLines', () => {
  it('suma cantidad × precio de cada línea', () => {
    expect(sumLines([line(10_000, 2), line(5_000, 3)])).toBe(35_000)
  })

  it('lista vacía da 0', () => {
    expect(sumLines([])).toBe(0)
  })
})

describe('calculateExchangeAmounts', () => {
  it('cambio del mismo precio: diferencia 0, total de orden 0, sin reembolso', () => {
    // camisa $50.000 por otra $50.000
    const a = calculateExchangeAmounts([line(50_000)], [line(50_000)])
    expect(a.returnedTotal).toBe(50_000)
    expect(a.exchangeTotal).toBe(50_000)
    expect(a.difference).toBe(0)
    expect(a.orderSubtotal).toBe(50_000)
    expect(a.orderDiscount).toBe(50_000)
    expect(a.orderTotal).toBe(0) // no se registra venta
    expect(a.refundDue).toBe(0) // no sale dinero
  })

  it('cambio por una prenda más cara: la orden registra solo la diferencia', () => {
    // devuelve $50.000, lleva $60.000 → paga $10.000
    const a = calculateExchangeAmounts([line(50_000)], [line(60_000)])
    expect(a.difference).toBe(10_000)
    expect(a.orderTotal).toBe(10_000) // venta = solo la diferencia
    expect(a.refundDue).toBe(0)
    // nunca el valor completo del item nuevo
    expect(a.orderTotal).not.toBe(a.exchangeTotal)
  })

  it('cambio por una prenda más barata: genera reembolso, sin venta', () => {
    // devuelve $50.000, lleva $40.000 → se le devuelven $10.000
    const a = calculateExchangeAmounts([line(50_000)], [line(40_000)])
    expect(a.difference).toBe(-10_000)
    expect(a.orderTotal).toBe(0) // no hay venta
    expect(a.refundDue).toBe(10_000) // sale dinero de caja
  })

  it('varios ítems a ambos lados se netean por totales', () => {
    // devuelve 2×$30.000 = $60.000; lleva $40.000 + $35.000 = $75.000
    const a = calculateExchangeAmounts(
      [line(30_000, 2)],
      [line(40_000), line(35_000)],
    )
    expect(a.returnedTotal).toBe(60_000)
    expect(a.exchangeTotal).toBe(75_000)
    expect(a.difference).toBe(15_000)
    expect(a.orderTotal).toBe(15_000)
    expect(a.orderDiscount).toBe(60_000)
    expect(a.refundDue).toBe(0)
  })

  it('el total de la orden de cambio nunca es el valor completo del item nuevo', () => {
    const casos: Array<[ReturnLine[], ReturnLine[]]> = [
      [[line(50_000)], [line(50_000)]],
      [[line(50_000)], [line(60_000)]],
      [[line(50_000)], [line(40_000)]],
      [[line(20_000, 2)], [line(100_000)]],
    ]
    for (const [ret, exc] of casos) {
      const a = calculateExchangeAmounts(ret, exc)
      // el total registrado como venta es la diferencia positiva, no el bruto
      expect(a.orderTotal).toBe(Math.max(0, a.exchangeTotal - a.returnedTotal))
      if (a.returnedTotal > 0) {
        expect(a.orderTotal).toBeLessThan(a.exchangeTotal)
      }
    }
  })
})
