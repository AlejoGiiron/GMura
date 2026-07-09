import { describe, it, expect } from 'vitest'
import {
  creditBalance,
  validateCreditPaymentAmount,
  resolveCreditPaymentImputation,
  isCreditFullyPaid,
  isCreditReturnBlocked,
} from './creditCalc'

describe('creditBalance', () => {
  it('saldo = total - pagado', () => {
    expect(creditBalance(100_000, 30_000)).toBe(70_000)
  })

  it('saldo nunca negativo (sobrepago defensivo)', () => {
    expect(creditBalance(100_000, 120_000)).toBe(0)
  })

  it('fiado saldado -> 0', () => {
    expect(creditBalance(50_000, 50_000)).toBe(0)
  })
})

describe('validateCreditPaymentAmount', () => {
  it('abono válido dentro del saldo -> null', () => {
    expect(validateCreditPaymentAmount(40_000, 100_000, 30_000)).toBeNull()
  })

  it('abono que salda exactamente el fiado -> null', () => {
    expect(validateCreditPaymentAmount(70_000, 100_000, 30_000)).toBeNull()
  })

  it('abono <= 0 -> nonpositive', () => {
    expect(validateCreditPaymentAmount(0, 100_000, 30_000)).toBe('nonpositive')
    expect(validateCreditPaymentAmount(-5_000, 100_000, 30_000)).toBe('nonpositive')
  })

  it('abono mayor al saldo -> exceeds_balance', () => {
    // saldo = 70.000; abonar 80.000 excede
    expect(validateCreditPaymentAmount(80_000, 100_000, 30_000)).toBe('exceeds_balance')
  })

  it('tolera redondeo de 0.5 (no rechaza por centavos)', () => {
    // saldo 70.000; abono 70.000,4 debe pasar por la tolerancia
    expect(validateCreditPaymentAmount(70_000.4, 100_000, 30_000)).toBeNull()
    // pero 70.001 sí excede
    expect(validateCreditPaymentAmount(70_001, 100_000, 30_000)).toBe('exceeds_balance')
  })
})

describe('isCreditFullyPaid', () => {
  it('saldado cuando pagado >= total', () => {
    expect(isCreditFullyPaid(100_000, 100_000)).toBe(true)
    expect(isCreditFullyPaid(100_000, 120_000)).toBe(true)
  })
  it('no saldado cuando falta', () => {
    expect(isCreditFullyPaid(100_000, 70_000)).toBe(false)
  })
  it('tolera redondeo de 0.5', () => {
    expect(isCreditFullyPaid(100_000, 99_999.6)).toBe(true)
    expect(isCreditFullyPaid(100_000, 99_999)).toBe(false)
  })
})

describe('isCreditReturnBlocked', () => {
  it('fiado con saldo pendiente -> bloqueado', () => {
    expect(
      isCreditReturnBlocked({ is_credit: true, total: 100_000, paid_amount: 30_000 }),
    ).toBe(true)
  })
  it('fiado ya saldado -> NO bloqueado (se comporta como venta normal)', () => {
    expect(
      isCreditReturnBlocked({ is_credit: true, total: 100_000, paid_amount: 100_000 }),
    ).toBe(false)
  })
  it('venta normal (no fiado) -> NO bloqueada aunque paid_amount sea 0', () => {
    expect(
      isCreditReturnBlocked({ is_credit: false, total: 100_000, paid_amount: 0 }),
    ).toBe(false)
  })
})

describe('resolveCreditPaymentImputation', () => {
  it('con turno abierto -> shift_id del turno, no histórico', () => {
    expect(resolveCreditPaymentImputation('shift-abc')).toEqual({
      shift_id: 'shift-abc',
      is_historical: false,
    })
  })

  it('sin turno -> shift_id null, no histórico', () => {
    expect(resolveCreditPaymentImputation(null)).toEqual({
      shift_id: null,
      is_historical: false,
    })
    expect(resolveCreditPaymentImputation(undefined)).toEqual({
      shift_id: null,
      is_historical: false,
    })
  })
})
