// Rangos de fecha para filtros, calculados SIEMPRE sobre la fecha civil de
// America/Bogota (Colombia = UTC-5 fijo, sin horario de verano), sin depender
// de la zona horaria del navegador. La fuente de verdad es un YYYY-MM-DD civil.
//
// Complementa src/lib/dates.ts (no lo duplica): aquí se PRODUCEN fechas civiles
// (YYYY-MM-DD); allí se CONVIERTEN esas fechas civiles a instantes UTC
// (bogotaDayStartToUtc / bogotaDayEndToUtc) al consultar columnas timestamptz.
// Son las dos direcciones del mismo modelo de zona horaria.

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'month'
  | 'prev-month'
  | 'custom'

export interface DateRange {
  // YYYY-MM-DD civil de Bogotá. En 'custom' sin elegir van vacías ('').
  dateFrom: string
  dateTo: string
}

// YYYY-MM-DD civil de Bogotá para el instante dado. Intl con timeZone fija el
// cálculo en Bogotá independientemente de la tz del runtime; 'en-CA' formatea
// en ISO (YYYY-MM-DD). `now` es inyectable para poder testear.
export function todayInBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

// ── Aritmética sobre fechas civiles (YYYY-MM-DD) ─────────────────────────────
// Se opera tratando el YYYY-MM-DD como fecha UTC pura: sumar/restar días o
// calcular bordes de mes no sufre corrimientos por tz ni DST. Nunca se lee la
// hora local del navegador.

function toUtcDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fmt(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(date: string, days: number): string {
  const d = toUtcDate(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fmt(d)
}

// Primer día del mes de la fecha dada (YYYY-MM-01).
function firstDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return fmt(new Date(Date.UTC(y, m - 1, 1)))
}

// Resuelve el rango civil de Bogotá para un preset. `now` inyectable para test.
export function resolveDateRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): DateRange {
  const today = todayInBogota(now)

  switch (preset) {
    case 'today':
      return { dateFrom: today, dateTo: today }
    case 'yesterday': {
      const y = addDays(today, -1)
      return { dateFrom: y, dateTo: y }
    }
    case 'last7':
      // 7 días incluyendo hoy → [hoy-6, hoy].
      return { dateFrom: addDays(today, -6), dateTo: today }
    case 'month':
      return { dateFrom: firstDayOfMonth(today), dateTo: today }
    case 'prev-month': {
      const firstThis = firstDayOfMonth(today)
      const lastPrev = addDays(firstThis, -1) // último día del mes anterior
      const firstPrev = firstDayOfMonth(lastPrev) // primer día del mes anterior
      return { dateFrom: firstPrev, dateTo: lastPrev }
    }
    case 'custom':
      // El caller conserva lo que el usuario haya tipeado en los inputs.
      return { dateFrom: '', dateTo: '' }
  }
}
