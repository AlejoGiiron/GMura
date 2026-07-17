import { describe, it, expect } from 'vitest'
import {
  resolveSaleCash,
  resolveSaleKind,
  sumPaymentsOnSaleDay,
} from './salesHistoryCash'

// Bogotá = UTC-5 fijo. Todas las fechas se escriben en UTC (como las devuelve
// Supabase) con el día Bogotá anotado al lado para que el caso se lea solo.
const SALE_DAY = '2026-07-16T20:00:00.000Z' // 16 jul, 15:00 Bogotá
const SAME_DAY_MORNING = '2026-07-16T14:00:00.000Z' // 16 jul, 09:00 Bogotá
const PREV_DAY = '2026-07-10T18:00:00.000Z' // 10 jul, 13:00 Bogotá

describe('resolveSaleKind', () => {
  it('marca separado cuando la orden nació de una conversión', () => {
    expect(resolveSaleKind({ is_credit: false, from_layaway: true })).toBe('layaway')
  })

  it('marca fiado cuando is_credit', () => {
    expect(resolveSaleKind({ is_credit: true, from_layaway: false })).toBe('credit')
  })

  it('marca directa cuando no es ni fiado ni separado', () => {
    expect(resolveSaleKind({ is_credit: false, from_layaway: false })).toBe('direct')
  })

  it('el separado tiene precedencia sobre el fiado (no deberían coexistir)', () => {
    expect(resolveSaleKind({ is_credit: true, from_layaway: true })).toBe('layaway')
  })
})

describe('sumPaymentsOnSaleDay', () => {
  it('descarta los abonos de otros días', () => {
    const sum = sumPaymentsOnSaleDay(SALE_DAY, [
      { amount: 40_000, created_at: SALE_DAY },
      { amount: 145_000, created_at: PREV_DAY },
    ])
    expect(sum).toBe(40_000)
  })

  it('descarta los abonos históricos aunque sean del día', () => {
    const sum = sumPaymentsOnSaleDay(SALE_DAY, [
      { amount: 40_000, created_at: SALE_DAY },
      { amount: 100_000, created_at: SALE_DAY, is_historical: true },
    ])
    expect(sum).toBe(40_000)
  })

  it('agrupa por día civil de Bogotá, no por día UTC', () => {
    // Venta a las 23:30 Bogotá del 16 (= 04:30Z del 17) y abono a las 23:00
    // Bogotá del 16 (= 04:00Z del 17). Mismo día Bogotá aunque en UTC sea el 17.
    const lateSale = '2026-07-17T04:30:00.000Z'
    const latePayment = '2026-07-17T04:00:00.000Z'
    expect(sumPaymentsOnSaleDay(lateSale, [{ amount: 25_000, created_at: latePayment }])).toBe(
      25_000,
    )
  })

  it('devuelve 0 sin abonos', () => {
    expect(sumPaymentsOnSaleDay(SALE_DAY, [])).toBe(0)
  })
})

describe('resolveSaleCash — separado', () => {
  it('cuenta solo el pago de cierre, no el total del separado', () => {
    // Separado de $185.000 con $145.000 abonados días atrás y $40.000 al cerrar.
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 185_000,
      is_credit: false,
      from_layaway: true,
      payments: [
        { amount: 145_000, created_at: PREV_DAY },
        { amount: 40_000, created_at: SALE_DAY },
      ],
    })
    expect(info.kind).toBe('layaway')
    expect(info.enteredToday).toBe(40_000)
    expect(info.showEnteredLine).toBe(true)
  })

  it('suma dos abonos del mismo día (abono en la mañana + cierre en la tarde)', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 185_000,
      is_credit: false,
      from_layaway: true,
      payments: [
        { amount: 100_000, created_at: PREV_DAY },
        { amount: 45_000, created_at: SAME_DAY_MORNING },
        { amount: 40_000, created_at: SALE_DAY },
      ],
    })
    expect(info.enteredToday).toBe(85_000)
    expect(info.showEnteredLine).toBe(true)
  })

  it('separado creado y pagado 100% el mismo día: entró el total y NO muestra la línea', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 185_000,
      is_credit: false,
      from_layaway: true,
      payments: [{ amount: 185_000, created_at: SAME_DAY_MORNING }],
    })
    expect(info.enteredToday).toBe(185_000)
    expect(info.showEnteredLine).toBe(false)
  })

  it('un abono histórico del día no infla lo que entró', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 185_000,
      is_credit: false,
      from_layaway: true,
      payments: [
        { amount: 145_000, created_at: SALE_DAY, is_historical: true },
        { amount: 40_000, created_at: SALE_DAY },
      ],
    })
    expect(info.enteredToday).toBe(40_000)
    expect(info.showEnteredLine).toBe(true)
  })
})

describe('resolveSaleCash — fiado', () => {
  it('con abono inicial: entró el abono, no el total', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 120_000,
      is_credit: true,
      from_layaway: false,
      payments: [{ amount: 30_000, created_at: SALE_DAY }],
    })
    expect(info.kind).toBe('credit')
    expect(info.enteredToday).toBe(30_000)
    expect(info.showEnteredLine).toBe(true)
  })

  it('sin abono inicial: entró $0 y la línea se muestra igual', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 120_000,
      is_credit: true,
      from_layaway: false,
      payments: [],
    })
    expect(info.enteredToday).toBe(0)
    expect(info.showEnteredLine).toBe(true)
  })

  it('los abonos posteriores no cuentan para el día de la venta', () => {
    // Fiado del 16 abonado el 20: ese dinero entró en otro día y en otro turno.
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 120_000,
      is_credit: true,
      from_layaway: false,
      payments: [
        { amount: 30_000, created_at: SALE_DAY },
        { amount: 90_000, created_at: '2026-07-20T18:00:00.000Z' },
      ],
    })
    expect(info.enteredToday).toBe(30_000)
  })

  it('fiado pagado completo el mismo día: NO muestra la línea', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 120_000,
      is_credit: true,
      from_layaway: false,
      payments: [{ amount: 120_000, created_at: SALE_DAY }],
    })
    expect(info.enteredToday).toBe(120_000)
    expect(info.showEnteredLine).toBe(false)
  })
})

describe('resolveSaleCash — venta directa', () => {
  it('entró el total y NO muestra la línea', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 80_000,
      is_credit: false,
      from_layaway: false,
    })
    expect(info.kind).toBe('direct')
    expect(info.enteredToday).toBe(80_000)
    expect(info.showEnteredLine).toBe(false)
  })

  it('ignora abonos si por algún motivo llegaran (el total manda)', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 80_000,
      is_credit: false,
      from_layaway: false,
      payments: [{ amount: 10_000, created_at: SALE_DAY }],
    })
    expect(info.enteredToday).toBe(80_000)
    expect(info.showEnteredLine).toBe(false)
  })

  it('tolera diferencias de centavos sin mostrar la línea', () => {
    const info = resolveSaleCash({
      created_at: SALE_DAY,
      total: 100_000.3,
      is_credit: true,
      from_layaway: false,
      payments: [{ amount: 100_000, created_at: SALE_DAY }],
    })
    expect(info.showEnteredLine).toBe(false)
  })
})
