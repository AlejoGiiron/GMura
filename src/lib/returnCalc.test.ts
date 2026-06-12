import { describe, it, expect } from 'vitest'
import {
  calculateExchangeAmounts,
  sumLines,
  isReturnablePayment,
  type ReturnLine,
} from './returnCalc'

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

describe('reembolso usa el precio FINAL vendido (no el catálogo)', () => {
  it('una prenda vendida con descuento se reembolsa al precio CON descuento', () => {
    // Catálogo $50.000, vendida a $30.000 (unit_price = final). El reembolso
    // de la devolución suma unit_price·qty → reembolsa $30.000, no $50.000.
    const refund = sumLines([line(30_000, 1)])
    expect(refund).toBe(30_000)
  })

  it('crédito del cambio = precio final de lo devuelto; ítem nuevo a catálogo', () => {
    // Devuelve una prenda comprada con descuento a $30.000 y lleva una nueva
    // a catálogo $40.000 → paga solo la diferencia $10.000.
    const a = calculateExchangeAmounts([line(30_000)], [line(40_000)])
    expect(a.returnedTotal).toBe(30_000) // crédito = lo realmente pagado
    expect(a.exchangeTotal).toBe(40_000) // ítem nuevo a catálogo
    expect(a.orderTotal).toBe(10_000) // solo la diferencia
    expect(a.refundDue).toBe(0)
  })
})

describe('isReturnablePayment (bloqueo de Addi)', () => {
  it('addi NO es devolvible/cambiable', () => {
    expect(isReturnablePayment('addi')).toBe(false)
  })

  it('efectivo, tarjeta y transferencia sí lo son', () => {
    expect(isReturnablePayment('cash')).toBe(true)
    expect(isReturnablePayment('card')).toBe(true)
    expect(isReturnablePayment('transfer')).toBe(true)
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
