import { describe, it, expect } from 'vitest'
import { todayInBogota, resolveDateRange } from './dateRange'

// Todos los tests usan un `now` FIJO elegido para que el instante UTC caiga en
// un día civil DISTINTO en Bogotá (UTC-5). Así se blinda que el cálculo ocurre
// en Bogotá y no en UTC ni en la tz del runner de tests.

describe('todayInBogota', () => {
  it('devuelve el día civil de Bogotá, no el de UTC', () => {
    // 02:00 UTC = 21:00 del día ANTERIOR en Bogotá.
    expect(todayInBogota(new Date('2026-03-15T02:00:00Z'))).toBe('2026-03-14')
  })

  it('respeta el cruce de medianoche UTC-5', () => {
    // 04:59:59 UTC = 23:59:59 Bogotá del día anterior.
    expect(todayInBogota(new Date('2026-03-15T04:59:59Z'))).toBe('2026-03-14')
    // 05:00:00 UTC = 00:00:00 Bogotá → ya es el día nuevo.
    expect(todayInBogota(new Date('2026-03-15T05:00:00Z'))).toBe('2026-03-15')
  })
})

describe('resolveDateRange', () => {
  // now = 2026-03-14T02:00:00Z → Bogotá 2026-03-13 21:00 → hoy civil = 2026-03-13
  const now = new Date('2026-03-14T02:00:00Z')

  it('today: [hoy, hoy] en fecha civil de Bogotá', () => {
    expect(resolveDateRange('today', now)).toEqual({
      dateFrom: '2026-03-13',
      dateTo: '2026-03-13',
    })
  })

  it('yesterday: [ayer, ayer]', () => {
    expect(resolveDateRange('yesterday', now)).toEqual({
      dateFrom: '2026-03-12',
      dateTo: '2026-03-12',
    })
  })

  it('last7: [hoy-6, hoy] (7 días incluyendo hoy)', () => {
    expect(resolveDateRange('last7', now)).toEqual({
      dateFrom: '2026-03-07',
      dateTo: '2026-03-13',
    })
  })

  it('month: [primer día del mes, hoy]', () => {
    expect(resolveDateRange('month', now)).toEqual({
      dateFrom: '2026-03-01',
      dateTo: '2026-03-13',
    })
  })

  it('prev-month: [primer día, último día del mes anterior]', () => {
    // Mes actual marzo → anterior febrero 2026 (no bisiesto → 28 días).
    expect(resolveDateRange('prev-month', now)).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    })
  })

  it('custom: devuelve strings vacías (el caller conserva lo tipeado)', () => {
    expect(resolveDateRange('custom', now)).toEqual({
      dateFrom: '',
      dateTo: '',
    })
  })

  // ── Bordes de mes ──────────────────────────────────────────────────────────

  it('month el día 1 del mes: [día 1, día 1]', () => {
    // 2026-05-01T12:00:00Z → Bogotá 07:00 → hoy = 2026-05-01
    const d1 = new Date('2026-05-01T12:00:00Z')
    expect(resolveDateRange('month', d1)).toEqual({
      dateFrom: '2026-05-01',
      dateTo: '2026-05-01',
    })
  })

  it('prev-month en enero → diciembre del año anterior', () => {
    // 2026-01-15T12:00:00Z → hoy Bogotá 2026-01-15
    const jan = new Date('2026-01-15T12:00:00Z')
    expect(resolveDateRange('prev-month', jan)).toEqual({
      dateFrom: '2025-12-01',
      dateTo: '2025-12-31',
    })
  })

  it('prev-month calcula bien febrero bisiesto (29 días)', () => {
    // Mes actual marzo 2024 → anterior febrero 2024 (bisiesto → 29 días).
    const mar2024 = new Date('2024-03-10T12:00:00Z')
    expect(resolveDateRange('prev-month', mar2024)).toEqual({
      dateFrom: '2024-02-01',
      dateTo: '2024-02-29',
    })
  })

  it('prev-month calcula bien un mes de 30 días (abril)', () => {
    // Mes actual mayo → anterior abril (30 días).
    const may = new Date('2026-05-10T12:00:00Z')
    expect(resolveDateRange('prev-month', may)).toEqual({
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })
  })

  it('prev-month calcula bien un mes de 31 días (enero desde febrero)', () => {
    // Mes actual febrero → anterior enero (31 días).
    const feb = new Date('2026-02-10T12:00:00Z')
    expect(resolveDateRange('prev-month', feb)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    })
  })
})
