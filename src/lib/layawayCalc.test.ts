import { describe, it, expect } from 'vitest'
import {
  calculateRequiredInitialPayment,
  resolveLayawayPaymentImputation,
  isLayawayOverdue,
  daysUntilExpiry,
} from './layawayCalc'

describe('calculateRequiredInitialPayment', () => {
  it("modo 'none' devuelve 0", () => {
    expect(
      calculateRequiredInitialPayment(100_000, {
        layaway_initial_payment_mode: 'none',
        layaway_initial_payment_value: 30_000,
      }),
    ).toBe(0)
  })

  it("modo 'fixed' devuelve el valor configurado", () => {
    expect(
      calculateRequiredInitialPayment(100_000, {
        layaway_initial_payment_mode: 'fixed',
        layaway_initial_payment_value: 30_000,
      }),
    ).toBe(30_000)
  })

  it("modo 'fixed' con valor mayor al total hace cap al total", () => {
    expect(
      calculateRequiredInitialPayment(100_000, {
        layaway_initial_payment_mode: 'fixed',
        layaway_initial_payment_value: 150_000,
      }),
    ).toBe(100_000)
  })

  it("modo 'percent' calcula subtotal × (valor / 100)", () => {
    expect(
      calculateRequiredInitialPayment(100_000, {
        layaway_initial_payment_mode: 'percent',
        layaway_initial_payment_value: 30,
      }),
    ).toBe(30_000)
  })

  it("modo 'percent' redondea a pesos sin decimales", () => {
    // 10% de 99.990 = 9.999 exacto
    expect(
      calculateRequiredInitialPayment(99_990, {
        layaway_initial_payment_mode: 'percent',
        layaway_initial_payment_value: 10,
      }),
    ).toBe(9_999)
    // 15% de 33.333 = 4.999,95 → 5.000
    expect(
      calculateRequiredInitialPayment(33_333, {
        layaway_initial_payment_mode: 'percent',
        layaway_initial_payment_value: 15,
      }),
    ).toBe(5_000)
  })

  it("modo 'percent' mayor a 100 se limita al total", () => {
    expect(
      calculateRequiredInitialPayment(100_000, {
        layaway_initial_payment_mode: 'percent',
        layaway_initial_payment_value: 150,
      }),
    ).toBe(100_000)
  })

  it('total 0 devuelve 0', () => {
    expect(
      calculateRequiredInitialPayment(0, {
        layaway_initial_payment_mode: 'fixed',
        layaway_initial_payment_value: 30_000,
      }),
    ).toBe(0)
  })
})

describe('resolveLayawayPaymentImputation (028)', () => {
  it('abono histórico → shift_id=null e is_historical=true (fuera del cuadre)', () => {
    // Aunque haya un turno abierto, el histórico NO se imputa a él.
    expect(resolveLayawayPaymentImputation(true, 'shift-abc')).toEqual({
      shift_id: null,
      is_historical: true,
    })
  })

  it('abono normal → se imputa al turno abierto e is_historical=false', () => {
    expect(resolveLayawayPaymentImputation(false, 'shift-abc')).toEqual({
      shift_id: 'shift-abc',
      is_historical: false,
    })
  })

  it('abono normal sin turno abierto → shift_id=null (compat), is_historical=false', () => {
    expect(resolveLayawayPaymentImputation(false, null)).toEqual({
      shift_id: null,
      is_historical: false,
    })
    expect(resolveLayawayPaymentImputation(false, undefined)).toEqual({
      shift_id: null,
      is_historical: false,
    })
  })
})

describe('isLayawayOverdue', () => {
  it('una fecha futura con estado activo no está vencida', () => {
    const expires_at = new Date(Date.now() + 10 * 86_400_000).toISOString()
    expect(isLayawayOverdue({ expires_at, status: 'active' })).toBe(false)
  })

  it('una fecha pasada con estado activo está vencida', () => {
    const expires_at = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(isLayawayOverdue({ expires_at, status: 'active' })).toBe(true)
  })

  it('un separado no activo nunca está vencido, aunque la fecha haya pasado', () => {
    const expires_at = new Date(Date.now() - 10 * 86_400_000).toISOString()
    expect(isLayawayOverdue({ expires_at, status: 'completed' })).toBe(false)
    expect(isLayawayOverdue({ expires_at, status: 'cancelled' })).toBe(false)
  })

  it('caso límite hoy: vence en una hora todavía no está vencido', () => {
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(isLayawayOverdue({ expires_at, status: 'active' })).toBe(false)
  })
})

describe('daysUntilExpiry', () => {
  // ── Por qué las fechas de abajo llevan 1 hora de holgura ────────────────────
  // daysUntilExpiry hace Math.floor((expires - Date.now()) / MS_PER_DAY), con un
  // Date.now() DISTINTO al que usa el test para construir la fecha. Si se
  // construye un múltiplo EXACTO de días, el valor cae justo en el borde del
  // floor: basta que el reloj avance 1 ms entre las dos llamadas para que el
  // resultado baje un entero (5 → 4, -3 → -4). Eso hacía fallar el gate al azar
  // (~0,1% y ~0,2% de las corridas, medido sobre 20.000 intentos).
  // La función NO tiene el defecto: floor es lo correcto para "días restantes".
  // La holgura mete cada fecha dentro de su bucket, lejos del borde.
  it('fecha futura devuelve días positivos', () => {
    // Dentro de 5 días y 1 hora.
    const expires_at = new Date(Date.now() + 5 * 86_400_000 + 60 * 60 * 1000).toISOString()
    expect(daysUntilExpiry({ expires_at })).toBe(5)
  })

  it('fecha pasada devuelve días negativos', () => {
    // Hace 2 días y 23 horas: dentro del bucket de -3, lejos del borde.
    const expires_at = new Date(Date.now() - 3 * 86_400_000 + 60 * 60 * 1000).toISOString()
    expect(daysUntilExpiry({ expires_at })).toBe(-3)
  })

  it('caso límite: vence en pocas horas devuelve 0', () => {
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(daysUntilExpiry({ expires_at })).toBe(0)
  })
})
