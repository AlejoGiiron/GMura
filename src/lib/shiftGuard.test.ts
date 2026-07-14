import { describe, it, expect } from 'vitest'
import {
  assertShiftForPayment,
  paymentRequiresShift,
  returnMovesCash,
  REQUIRE_SHIFT_MESSAGE,
} from './shiftGuard'

// Las 4 mutations de dinero (useCreateLayaway [abono inicial], useAddLayawayPayment,
// useCompleteLayaway [pago final], useAddCreditPayment) delegan su guard de turno
// en assertShiftForPayment. useReturnMutations lo combina con returnMovesCash.
// Estos tests cubren la decisión pura del guard aislada de React y de la red.

describe('assertShiftForPayment — guard de turno para pagos', () => {
  it('LANZA con el mensaje claro cuando no hay turno (undefined)', () => {
    expect(() => assertShiftForPayment(undefined)).toThrowError(
      REQUIRE_SHIFT_MESSAGE,
    )
  })

  it('LANZA cuando el turno es null', () => {
    expect(() => assertShiftForPayment(null)).toThrowError(REQUIRE_SHIFT_MESSAGE)
  })

  it('LANZA cuando el turno es cadena vacía (id inválido)', () => {
    expect(() => assertShiftForPayment('')).toThrowError(REQUIRE_SHIFT_MESSAGE)
  })

  it('NO lanza cuando hay un turno abierto', () => {
    expect(() => assertShiftForPayment('shift-123')).not.toThrow()
  })

  // ── Excepción #3C: pagos históricos ─────────────────────────────────────────
  it('#3C: NO lanza para un abono HISTÓRICO aunque no haya turno', () => {
    expect(() =>
      assertShiftForPayment(null, { isHistorical: true }),
    ).not.toThrow()
    expect(() =>
      assertShiftForPayment(undefined, { isHistorical: true }),
    ).not.toThrow()
  })

  it('#3C: un abono NO histórico sin turno sí lanza (control)', () => {
    expect(() =>
      assertShiftForPayment(null, { isHistorical: false }),
    ).toThrowError(REQUIRE_SHIFT_MESSAGE)
  })

  it('#3C: histórico con turno abierto tampoco lanza (idempotente)', () => {
    expect(() =>
      assertShiftForPayment('shift-123', { isHistorical: true }),
    ).not.toThrow()
  })
})

describe('paymentRequiresShift — decisión booleana para la UX', () => {
  it('un pago normal (sin opts) requiere turno', () => {
    expect(paymentRequiresShift()).toBe(true)
    expect(paymentRequiresShift({})).toBe(true)
    expect(paymentRequiresShift({ isHistorical: false })).toBe(true)
  })

  it('#3C: un pago histórico NO requiere turno (el bloqueo desaparece)', () => {
    expect(paymentRequiresShift({ isHistorical: true })).toBe(false)
  })
})

describe('returnMovesCash — ¿la devolución/cambio mueve efectivo?', () => {
  const base = {
    returnedValue: 0,
    exchangeRefundDue: 0,
    exchangeCharge: 0,
  }

  it('devolución pura en EFECTIVO → mueve caja (reembolso sale del cajón)', () => {
    expect(
      returnMovesCash({
        ...base,
        type: 'return',
        refundMethod: 'cash',
        returnedValue: 50000,
      }),
    ).toBe(true)
  })

  it('devolución pura por TRANSFERENCIA → NO mueve el cajón', () => {
    expect(
      returnMovesCash({
        ...base,
        type: 'return',
        refundMethod: 'transfer',
        returnedValue: 50000,
      }),
    ).toBe(false)
  })

  it('cambio del MISMO valor (sin diferencia) → no mueve caja', () => {
    expect(
      returnMovesCash({ ...base, type: 'exchange', refundMethod: 'cash' }),
    ).toBe(false)
  })

  it('cambio más BARATO con reembolso en efectivo → mueve caja', () => {
    expect(
      returnMovesCash({
        ...base,
        type: 'exchange',
        refundMethod: 'cash',
        exchangeRefundDue: 20000,
      }),
    ).toBe(true)
  })

  it('cambio más BARATO reembolsado por transferencia → no mueve el cajón', () => {
    expect(
      returnMovesCash({
        ...base,
        type: 'exchange',
        refundMethod: 'transfer',
        exchangeRefundDue: 20000,
      }),
    ).toBe(false)
  })

  it('cambio más CARO (cobra diferencia) → mueve caja aunque sea efectivo', () => {
    // Es un ingreso que hay que imputar al turno → la orden del cambio debe
    // llevar shift_id, por eso el guard exige turno para este caso.
    expect(
      returnMovesCash({
        ...base,
        type: 'exchange',
        refundMethod: 'cash',
        exchangeCharge: 30000,
      }),
    ).toBe(true)
  })

  it('cambio más CARO cobrado por TARJETA → igual exige turno (ingreso a imputar)', () => {
    expect(
      returnMovesCash({
        ...base,
        type: 'exchange',
        refundMethod: 'card',
        exchangeCharge: 30000,
      }),
    ).toBe(true)
  })
})
