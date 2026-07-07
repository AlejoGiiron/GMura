import { describe, it, expect } from 'vitest'
import {
  calculateExchangeAmounts,
  sumLines,
  sumCatalog,
  isReturnablePayment,
  type ReturnLine,
} from './returnCalc'

// Helper: por defecto sin descuento (list = unit). Para simular descuento por
// ítem se pasa un list_price mayor al unit_price.
function line(unit_price: number, qty = 1, list_price = unit_price): ReturnLine {
  return { unit_price, qty, list_price }
}

describe('sumLines / sumCatalog', () => {
  it('sumLines suma cantidad × precio PAGADO de cada línea', () => {
    expect(sumLines([line(10_000, 2), line(5_000, 3)])).toBe(35_000)
  })

  it('sumCatalog suma cantidad × precio de CATÁLOGO de cada línea', () => {
    // pagado 30k pero catálogo 40k → cuenta el catálogo
    expect(sumCatalog([line(30_000, 2, 40_000)])).toBe(80_000)
  })

  it('listas vacías dan 0', () => {
    expect(sumLines([])).toBe(0)
    expect(sumCatalog([])).toBe(0)
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

describe('calculateExchangeAmounts — descuento absoluto trasladado', () => {
  // Escenario del lab (orden #53): catálogo $100.000, pagado $80.000,
  // descuento absoluto $20.000. Un cambio por el MISMO catálogo NO debe cobrar.
  const devueltoConDescuento = [line(80_000, 1, 100_000)]

  it('EQ — cambio por igual catálogo ($100.000): diferencia 0 (no cobra)', () => {
    const a = calculateExchangeAmounts(devueltoConDescuento, [line(100_000, 1, 100_000)])
    expect(a.creditoPagado).toBe(80_000) // lo que realmente pagó
    expect(a.descuentoTrasladado).toBe(20_000) // 100k − 80k
    expect(a.catalogoDevuelto).toBe(100_000)
    expect(a.catalogoNuevo).toBe(100_000)
    expect(a.nuevoNeto).toBe(80_000) // 100k − 20k de descuento trasladado
    expect(a.difference).toBe(0) // ← el bug daba +20.000
    expect(a.shortfall).toBe(0)
    expect(a.orderTotal).toBe(0) // no se registra venta
    expect(a.refundDue).toBe(0) // no sale dinero
    // el nuevo neto queda igual al crédito → cambio parejo
    expect(a.nuevoNeto - a.creditoPagado).toBe(a.difference)
  })

  it('HI — cambio por más caro ($150.000): cobra $50.000', () => {
    const a = calculateExchangeAmounts(devueltoConDescuento, [line(150_000, 1, 150_000)])
    expect(a.descuentoTrasladado).toBe(20_000)
    expect(a.catalogoNuevo).toBe(150_000)
    expect(a.nuevoNeto).toBe(130_000) // 150k − 20k
    expect(a.difference).toBe(50_000) // 150k − 100k  (≡ 130k − 80k)
    expect(a.shortfall).toBe(0)
    expect(a.orderTotal).toBe(50_000) // venta = solo la diferencia
    expect(a.refundDue).toBe(0)
    // nunca el valor completo del ítem nuevo
    expect(a.orderTotal).not.toBe(a.catalogoNuevo)
  })

  it('LO — cambio por más barato ($60.000): diferencia −$40.000, shortfall $40.000', () => {
    const a = calculateExchangeAmounts(devueltoConDescuento, [line(60_000, 1, 60_000)])
    expect(a.descuentoTrasladado).toBe(20_000)
    expect(a.catalogoNuevo).toBe(60_000)
    expect(a.nuevoNeto).toBe(40_000) // 60k − 20k
    expect(a.difference).toBe(-40_000) // 60k − 100k  (≡ 40k − 80k)
    expect(a.shortfall).toBe(40_000) // falta $40.000 de catálogo para cubrir
    expect(a.orderTotal).toBe(0) // no hay venta
    // en Fase 1 aún se calcula el reembolso; Fase 3 lo bloqueará antes
    expect(a.refundDue).toBe(40_000)
  })
})

describe('calculateExchangeAmounts — casos sanos sin descuento', () => {
  it('sin descuento, cambio por igual catálogo: diferencia 0 (no regresión)', () => {
    // unit = list = 100k en ambos lados
    const a = calculateExchangeAmounts([line(100_000)], [line(100_000)])
    expect(a.descuentoTrasladado).toBe(0)
    expect(a.difference).toBe(0)
    expect(a.orderTotal).toBe(0)
    expect(a.refundDue).toBe(0)
  })

  it('sin descuento, cambio por más caro: registra solo la diferencia', () => {
    const a = calculateExchangeAmounts([line(50_000)], [line(60_000)])
    expect(a.difference).toBe(10_000)
    expect(a.orderTotal).toBe(10_000)
    expect(a.refundDue).toBe(0)
    expect(a.orderTotal).not.toBe(a.catalogoNuevo)
  })

  it('sin descuento, cambio por más barato: genera reembolso, sin venta', () => {
    const a = calculateExchangeAmounts([line(50_000)], [line(40_000)])
    expect(a.difference).toBe(-10_000)
    expect(a.shortfall).toBe(10_000)
    expect(a.orderTotal).toBe(0)
    expect(a.refundDue).toBe(10_000)
  })
})

describe('calculateExchangeAmounts — pool por totales (varios a cada lado)', () => {
  it('varios devueltos con descuento + varios nuevos: netea por totales', () => {
    // Devuelve 2 prendas con descuento: catálogo 2×$100.000 = $200.000,
    // pagadas 2×$80.000 = $160.000 (descuento total $40.000).
    // Lleva dos nuevas a catálogo $120.000 + $110.000 = $230.000.
    const devueltos = [line(80_000, 2, 100_000)]
    const nuevos = [line(120_000, 1, 120_000), line(110_000, 1, 110_000)]
    const a = calculateExchangeAmounts(devueltos, nuevos)
    expect(a.creditoPagado).toBe(160_000)
    expect(a.catalogoDevuelto).toBe(200_000)
    expect(a.descuentoTrasladado).toBe(40_000)
    expect(a.catalogoNuevo).toBe(230_000)
    expect(a.nuevoNeto).toBe(190_000) // 230k − 40k
    expect(a.difference).toBe(30_000) // 230k − 200k  (≡ 190k − 160k)
    expect(a.shortfall).toBe(0)
    expect(a.orderTotal).toBe(30_000)
    expect(a.orderSubtotal).toBe(230_000)
    expect(a.orderDiscount).toBe(200_000) // subtotal − total
    expect(a.refundDue).toBe(0)
    // Equivalencia algebraica del insight del diagnóstico:
    expect(a.nuevoNeto - a.creditoPagado).toBe(a.difference)
  })

  it('el total de la orden nunca es el valor bruto de lo nuevo', () => {
    const casos: Array<[ReturnLine[], ReturnLine[]]> = [
      [[line(80_000, 1, 100_000)], [line(100_000)]],
      [[line(80_000, 1, 100_000)], [line(150_000)]],
      [[line(50_000)], [line(60_000)]],
    ]
    for (const [ret, exc] of casos) {
      const a = calculateExchangeAmounts(ret, exc)
      expect(a.orderTotal).toBe(Math.max(0, a.difference))
      if (a.orderTotal > 0) {
        expect(a.orderTotal).toBeLessThan(a.catalogoNuevo)
      }
    }
  })
})
