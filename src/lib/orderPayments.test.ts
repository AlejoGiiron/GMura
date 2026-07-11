import { describe, it, expect } from 'vitest'
import {
  assertValidPayments,
  primaryPaymentMethod,
  isDirectPaymentMethod,
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

  it('monto no positivo: lanza', () => {
    expect(() => assertValidPayments([line('cash', 0)], 0)).toThrow(
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
})
