import { describe, it, expect } from 'vitest'
import {
  assertValidPayments,
  assertValidAbono,
  sumPaymentLines,
  primaryPaymentMethod,
  isDirectPaymentMethod,
  isNoChargeSale,
  paymentLinesForTotal,
  type PaymentLine,
} from './orderPayments'

const line = (method: PaymentLine['method'], amount: number): PaymentLine => ({
  method,
  amount,
})

describe('isDirectPaymentMethod', () => {
  it('acepta cash/card/transfer/addi y rechaza credit', () => {
    expect(isDirectPaymentMethod('cash')).toBe(true)
    expect(isDirectPaymentMethod('card')).toBe(true)
    expect(isDirectPaymentMethod('transfer')).toBe(true)
    expect(isDirectPaymentMethod('addi')).toBe(true)
    // 'credit' es fiado (flujo aparte), no un método de pago directo.
    expect(isDirectPaymentMethod('credit')).toBe(false)
  })
})

describe('primaryPaymentMethod', () => {
  it('un solo método: ese es el primario', () => {
    expect(primaryPaymentMethod([line('cash', 80_000)])).toBe('cash')
  })

  it('mixto: el de mayor monto', () => {
    expect(
      primaryPaymentMethod([line('cash', 50_000), line('card', 30_000)]),
    ).toBe('cash')
    expect(
      primaryPaymentMethod([line('cash', 20_000), line('card', 60_000)]),
    ).toBe('card')
  })

  it('empate: desempate estable por nombre (determinista)', () => {
    // card < cash < transfer alfabéticamente; con montos iguales gana 'card'.
    expect(
      primaryPaymentMethod([line('cash', 40_000), line('card', 40_000)]),
    ).toBe('card')
    expect(
      primaryPaymentMethod([line('transfer', 40_000), line('cash', 40_000)]),
    ).toBe('cash')
  })
})

describe('assertValidPayments', () => {
  it('una línea que cuadra con el total: no lanza', () => {
    expect(() => assertValidPayments([line('cash', 80_000)], 80_000)).not.toThrow()
  })

  it('mixto que cuadra: no lanza', () => {
    expect(() =>
      assertValidPayments([line('cash', 50_000), line('card', 30_000)], 80_000),
    ).not.toThrow()
  })

  it('sin líneas: lanza', () => {
    expect(() => assertValidPayments([], 80_000)).toThrow('Falta el método de pago')
  })

  it('monto no positivo en una venta con total > 0: lanza', () => {
    // La excepción de la venta sin cargo es por TOTAL, no por línea: un pago de
    // $0 dentro de una venta que sí cobra sigue siendo inválido.
    expect(() => assertValidPayments([line('cash', 0)], 80_000)).toThrow(
      'mayor a $0',
    )
    expect(() =>
      assertValidPayments([line('cash', 80_000), line('card', -10_000)], 70_000),
    ).toThrow('mayor a $0')
  })

  it('método repetido: lanza (consolidar en una línea)', () => {
    expect(() =>
      assertValidPayments([line('cash', 40_000), line('cash', 40_000)], 80_000),
    ).toThrow('No repitas el mismo método')
  })

  it("método 'credit' no es válido en venta directa: lanza", () => {
    expect(() => assertValidPayments([line('credit', 80_000)], 80_000)).toThrow(
      'inválido',
    )
  })

  it('Σ no cuadra con el total (falta): lanza', () => {
    expect(() =>
      assertValidPayments([line('cash', 50_000), line('card', 20_000)], 80_000),
    ).toThrow('no cuadran con el total')
  })

  it('Σ no cuadra con el total (sobra): lanza', () => {
    expect(() =>
      assertValidPayments([line('cash', 50_000), line('card', 40_000)], 80_000),
    ).toThrow('no cuadran con el total')
  })

  it('tolerancia de centavos: diferencia <= 0.5 pasa', () => {
    // Redondeos pueden dejar $0.30 de diferencia; no debe bloquear.
    expect(() =>
      assertValidPayments([line('cash', 50_000), line('card', 30_000.3)], 80_000),
    ).not.toThrow()
  })

  // ── Venta SIN CARGO (total $0, todos los ítems de regalo) ─────────────────
  // Bug de producción: el modal armaba una línea de $0 y la validación la
  // rechazaba con "Cada pago debe ser mayor a $0" → la venta no se podía cerrar.
  // El modelo SÍ admite el caso: la 032 excluyó del backfill las órdenes de
  // total 0, que quedaron con CERO filas en order_payments.
  it('total $0 sin líneas: válido (no entró plata, no hay pago que registrar)', () => {
    expect(() => assertValidPayments([], 0)).not.toThrow()
  })

  it('total $0 con una línea de $0: lanza (la línea se omite, no se registra)', () => {
    expect(() => assertValidPayments([line('cash', 0)], 0)).toThrow(
      'no lleva pago',
    )
  })

  it('total $0 con una línea > 0: lanza (sería plata inventada)', () => {
    expect(() => assertValidPayments([line('cash', 50_000)], 0)).toThrow(
      'no lleva pago',
    )
  })

  it('venta PARCIALMENTE de regalo (total > 0): flujo normal con su pago', () => {
    // Dos ítems de $100.000, uno marcado como regalo → total $100.000. No es
    // una venta sin cargo: exige su línea de pago como cualquier otra.
    expect(() => assertValidPayments([line('cash', 100_000)], 100_000)).not.toThrow()
    expect(() => assertValidPayments([], 100_000)).toThrow('Falta el método de pago')
  })
})

describe('isNoChargeSale', () => {
  it('$0 es sin cargo; cualquier monto cobrable no lo es', () => {
    expect(isNoChargeSale(0)).toBe(true)
    // Tolerancia de centavos (la misma 0.5 de la paridad).
    expect(isNoChargeSale(0.3)).toBe(true)
    expect(isNoChargeSale(1_000)).toBe(false)
    expect(isNoChargeSale(0.5)).toBe(false)
  })
})

describe('paymentLinesForTotal', () => {
  it('total $0: descarta las líneas que arma la UI (la de $0 del modo simple)', () => {
    expect(paymentLinesForTotal([line('cash', 0)], 0)).toEqual([])
    expect(paymentLinesForTotal([], 0)).toEqual([])
  })

  it('total > 0: no toca nada (el caso normal no se afloja)', () => {
    const lines = [line('cash', 50_000), line('card', 30_000)]
    expect(paymentLinesForTotal(lines, 80_000)).toBe(lines)
  })

  it('normalizar + validar deja pasar la venta sin cargo', () => {
    // Lo que hace useCreateOrder: normaliza y valida. Con total $0 no lanza.
    const lines = paymentLinesForTotal([line('cash', 0)], 0)
    expect(lines).toEqual([])
    expect(() => assertValidPayments(lines, 0)).not.toThrow()
  })
})

describe('sumPaymentLines', () => {
  it('suma los montos de las líneas', () => {
    expect(sumPaymentLines([line('cash', 30_000), line('card', 20_000)])).toBe(
      50_000,
    )
    expect(sumPaymentLines([])).toBe(0)
  })
})

describe('assertValidAbono', () => {
  it('abono de un método por debajo del saldo: no lanza', () => {
    expect(() => assertValidAbono([line('cash', 30_000)], 50_000)).not.toThrow()
  })

  it('abono MIXTO que no supera el saldo: no lanza', () => {
    // Abono de $50k = $30k efectivo + $20k tarjeta, saldo $80k.
    expect(() =>
      assertValidAbono([line('cash', 30_000), line('card', 20_000)], 80_000),
    ).not.toThrow()
  })

  it('abono igual al saldo (payoff): no lanza', () => {
    expect(() =>
      assertValidAbono([line('cash', 50_000), line('card', 30_000)], 80_000),
    ).not.toThrow()
  })

  it('abono que SUPERA el saldo: lanza', () => {
    expect(() =>
      assertValidAbono([line('cash', 50_000), line('card', 40_000)], 80_000),
    ).toThrow('no puede superar el saldo')
  })

  it('reusa las validaciones comunes (método repetido, monto>0, sin líneas)', () => {
    expect(() =>
      assertValidAbono([line('cash', 20_000), line('cash', 10_000)], 80_000),
    ).toThrow('No repitas el mismo método')
    expect(() => assertValidAbono([line('cash', 0)], 80_000)).toThrow('mayor a $0')
    expect(() => assertValidAbono([], 80_000)).toThrow('Falta el método de pago')
  })
})
