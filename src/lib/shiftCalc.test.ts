import { describe, it, expect } from 'vitest'
import {
  calculateShiftSummary,
  reconcileCash,
  shiftDifference,
  type ShiftOrderInput,
  type ShiftLayawayPaymentInput,
  type ShiftSummaryInput,
} from './shiftCalc'

function label(diff: number): 'CUADRADO' | 'SOBRANTE' | 'FALTANTE' {
  if (diff > 0) return 'SOBRANTE'
  if (diff < 0) return 'FALTANTE'
  return 'CUADRADO'
}

function order(
  id: string,
  total: number,
  payment_method: ShiftOrderInput['payment_method'] = 'cash',
  return_id: string | null = null,
): ShiftOrderInput {
  return { id, total, payment_method, return_id }
}

function abono(
  amount: number,
  payment_method: ShiftLayawayPaymentInput['payment_method'] = 'cash',
): ShiftLayawayPaymentInput {
  return { amount, payment_method }
}

describe('calculateShiftSummary', () => {
  it('turno solo con ventas en efectivo: esperado = apertura + ventas', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 50_000), order('o2', 30_000)],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.regularSalesTotal).toBe(80_000)
    expect(r.totalSales).toBe(80_000)
    expect(r.cashSales).toBe(80_000)
    expect(r.totalExpenses).toBe(0)
    expect(r.expectedCash).toBe(180_000)
    expect(r.orderCount).toBe(2)
  })

  it('ventas en varios métodos: solo el efectivo afecta el esperado', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        order('o1', 50_000, 'cash'),
        order('o2', 30_000, 'card'),
        order('o3', 20_000, 'transfer'),
      ],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.totalSales).toBe(100_000)
    expect(r.cashSales).toBe(50_000)
    expect(r.expectedCash).toBe(150_000) // 100.000 + 50.000 efectivo
    // salesByMethod ordenado por total descendente
    expect(r.salesByMethod.map((s) => s.method)).toEqual([
      'cash',
      'card',
      'transfer',
    ])
    expect(r.salesByMethod[0]).toMatchObject({ method: 'cash', total: 50_000, count: 1 })
  })

  it('recargo Addi: el total con recargo cuenta como venta Addi y NO toca el efectivo', () => {
    // La orden Addi llega con total ya incluido el recargo (subtotal 100k +
    // recargo 15k = 115k). El recargo no es efectivo → expectedCash no cambia.
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        order('o1', 50_000, 'cash'),
        order('o2', 115_000, 'addi'),
      ],
      layawayPayments: [],
      expenses: [],
    })
    const addi = r.salesByMethod.find((s) => s.method === 'addi')
    expect(addi).toMatchObject({ method: 'addi', total: 115_000, count: 1 })
    expect(r.totalSales).toBe(165_000) // 50.000 + 115.000 (recargo incluido)
    expect(r.cashSales).toBe(50_000) // Addi no es efectivo
    expect(r.expectedCash).toBe(150_000) // 100.000 + 50.000, intacto pese al recargo
  })

  it('turno con gastos: esperado = apertura + ventas efectivo - gastos', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 60_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 20_000 }, { amount: 5_000 }],
    })
    expect(r.totalExpenses).toBe(25_000)
    expect(r.expectedCash).toBe(135_000) // 100.000 + 60.000 - 25.000
  })

  it('abonos de separados en efectivo suman al efectivo del cuadre', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 40_000, 'cash')],
      layawayPayments: [abono(20_000, 'cash'), abono(10_000, 'card')],
      expenses: [],
    })
    expect(r.regularSalesTotal).toBe(40_000)
    expect(r.layawayPaymentsTotal).toBe(30_000)
    expect(r.totalSales).toBe(70_000)
    // efectivo = 40.000 venta + 20.000 abono efectivo (el abono en tarjeta no)
    expect(r.cashSales).toBe(60_000)
    expect(r.expectedCash).toBe(160_000)
  })

  it('una devolución en efectivo (cash_expense) resta del esperado', () => {
    // venta de 50.000 en efectivo + devolución de esa venta como egreso 50.000
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 50_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 50_000 }], // "Devolución venta #N"
    })
    expect(r.cashSales).toBe(50_000)
    expect(r.totalExpenses).toBe(50_000)
    expect(r.expectedCash).toBe(100_000) // 100.000 + 50.000 - 50.000
  })

  it('NO duplica los separados completados (excluye órdenes con converted_order_id)', () => {
    // 'conv1' es la orden generada al completar un separado: debe excluirse,
    // porque el dinero del separado entra vía sus abonos (layawayPayments).
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('sale1', 50_000, 'cash'), order('conv1', 80_000, 'cash')],
      excludedOrderIds: ['conv1'],
      layawayPayments: [abono(80_000, 'cash')],
      expenses: [],
    })
    expect(r.orderCount).toBe(1) // solo sale1
    expect(r.regularSalesTotal).toBe(50_000) // sin la orden de conversión
    expect(r.layawayPaymentsTotal).toBe(80_000)
    expect(r.totalSales).toBe(130_000) // 50.000 venta + 80.000 abonos
    expect(r.cashSales).toBe(130_000)
    expect(r.expectedCash).toBe(230_000)
  })

  it('caso combinado completo (ventas + abonos + gastos + devolución)', () => {
    const r = calculateShiftSummary({
      openingAmount: 200_000,
      orders: [
        order('o1', 100_000, 'cash'),
        order('o2', 60_000, 'card'),
        order('conv1', 90_000, 'cash'), // excluida
      ],
      excludedOrderIds: ['conv1'],
      layawayPayments: [abono(90_000, 'cash'), abono(40_000, 'transfer')],
      expenses: [{ amount: 30_000 }, { amount: 50_000 }], // gasto + devolución
    })
    // Ventas regulares contadas: 100.000 (cash) + 60.000 (card) = 160.000
    expect(r.regularSalesTotal).toBe(160_000)
    expect(r.layawayPaymentsTotal).toBe(130_000)
    expect(r.totalSales).toBe(290_000)
    expect(r.orderCount).toBe(2)
    // Efectivo: 100.000 venta + 90.000 abono efectivo = 190.000
    expect(r.cashSales).toBe(190_000)
    expect(r.totalExpenses).toBe(80_000)
    // 200.000 + 190.000 - 80.000
    expect(r.expectedCash).toBe(310_000)
  })

  it('un turno vacío parte del monto de apertura', () => {
    const r = calculateShiftSummary({
      openingAmount: 50_000,
      orders: [],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.totalSales).toBe(0)
    expect(r.cashSales).toBe(0)
    expect(r.expectedCash).toBe(50_000)
    expect(r.overdraft).toBe(0)
    expect(r.salesByMethod).toEqual([])
  })

  it('caso foto vía calculateShiftSummary: egreso mayor a lo disponible', () => {
    // apertura 162k, sin ventas, egreso 180k (pago a proveedor en efectivo)
    const r = calculateShiftSummary({
      openingAmount: 162_000,
      orders: [],
      layawayPayments: [],
      expenses: [{ amount: 180_000 }],
    })
    expect(r.cashSales).toBe(0)
    expect(r.totalExpenses).toBe(180_000)
    expect(r.expectedCash).toBe(0) // tope en 0, no negativo
    expect(r.overdraft).toBe(18_000)
    // contado 0 → FALTANTE 18.000 (no SOBRANTE)
    expect(shiftDifference(0, r)).toBe(-18_000)
  })
})

describe('reconcileCash + shiftDifference (Lógica B del cuadre)', () => {
  it('caso normal cuadrado: ap 50k + ventas 100k, sin egresos, contado 150k', () => {
    const rec = reconcileCash(150_000, 0)
    expect(rec).toEqual({ expectedCash: 150_000, overdraft: 0 })
    const diff = shiftDifference(150_000, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('faltante por error de conteo: contado 145k → -5k FALTANTE', () => {
    const rec = reconcileCash(150_000, 0)
    const diff = shiftDifference(145_000, rec)
    expect(diff).toBe(-5_000)
    expect(label(diff)).toBe('FALTANTE')
  })

  it('sobrante: contado 155k → +5k SOBRANTE', () => {
    const rec = reconcileCash(150_000, 0)
    const diff = shiftDifference(155_000, rec)
    expect(diff).toBe(5_000)
    expect(label(diff)).toBe('SOBRANTE')
  })

  it('egreso normal: ap 50k + ventas 100k, egresos 30k, contado 120k → CUADRADO', () => {
    const rec = reconcileCash(150_000, 30_000)
    expect(rec).toEqual({ expectedCash: 120_000, overdraft: 0 })
    const diff = shiftDifference(120_000, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('CASO FOTO: ap 162k, egresos 180k, contado 0 → FALTANTE 18.000', () => {
    const rec = reconcileCash(162_000, 180_000)
    expect(rec).toEqual({ expectedCash: 0, overdraft: 18_000 })
    const diff = shiftDifference(0, rec)
    expect(diff).toBe(-18_000)
    expect(label(diff)).toBe('FALTANTE')
  })

  it('pago exacto: ap 100k, egresos 100k, contado 0 → CUADRADO', () => {
    const rec = reconcileCash(100_000, 100_000)
    expect(rec).toEqual({ expectedCash: 0, overdraft: 0 })
    const diff = shiftDifference(0, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('sobregiro con conteo parcial: ap 162k, egresos 180k, contado 10k → FALTANTE 8.000', () => {
    const rec = reconcileCash(162_000, 180_000)
    const diff = shiftDifference(10_000, rec)
    expect(diff).toBe(-8_000)
    expect(label(diff)).toBe('FALTANTE')
  })
})

describe('calculateShiftSummary — devoluciones aparte (P5)', () => {
  // Escenario del test manual: venta 50k; devolución -50k; cambio más caro
  // (+10k cobrado); cambio más barato (-5k reembolsado). Todo en efectivo.
  const escenario = (): ShiftSummaryInput => ({
    openingAmount: 100_000,
    orders: [
      order('venta1', 50_000, 'cash'), // venta regular
      order('dif', 10_000, 'cash', 'ret-caro'), // ingreso por cambio más caro
      // las órdenes $0 de los cambios (mismo precio / más barato) no aportan
    ],
    layawayPayments: [],
    expenses: [
      { amount: 50_000, kind: 'return' }, // reembolso devolución
      { amount: 5_000, kind: 'return' }, // reembolso diferencia barata
    ],
  })

  it('clasifica ingresos y egresos de devolución sin tocarlos de ventas/egresos', () => {
    const r = calculateShiftSummary(escenario())
    // Ventas regulares: solo la venta de 50k (no el ingreso por cambio)
    expect(r.regularSalesTotal).toBe(50_000)
    expect(r.orderCount).toBe(1) // la orden con return_id no cuenta como venta
    expect(r.salesByMethod.reduce((s, m) => s + m.total, 0)).toBe(50_000)
    // Devoluciones
    expect(r.returnsIncome).toBe(10_000)
    expect(r.returnsExpense).toBe(55_000)
    expect(r.returnsNet).toBe(-45_000)
    // Egresos regulares (sin reembolsos)
    expect(r.regularExpensesTotal).toBe(0)
  })

  it('INVARIANTE: expectedCash es idéntico con y sin la clasificación de devoluciones', () => {
    const data = escenario()
    const r = calculateShiftSummary(data)
    // Cálculo "viejo" (sin distinguir devoluciones): todo el efectivo entra,
    // todos los egresos restan.
    const allCash =
      data.orders.reduce(
        (s, o) => s + (o.payment_method === 'cash' ? o.total : 0),
        0,
      ) +
      data.layawayPayments.reduce(
        (s, p) => s + (p.payment_method === 'cash' ? p.amount : 0),
        0,
      )
    const allExpenses = data.expenses.reduce((s, e) => s + e.amount, 0)
    const expectedOld = Math.max(0, data.openingAmount + allCash - allExpenses)
    // 100k + (50k + 10k) - (50k + 5k) = 105k
    expect(r.expectedCash).toBe(expectedOld)
    expect(r.expectedCash).toBe(105_000)
    expect(r.cashSales).toBe(60_000) // incluye el ingreso por cambio
    expect(r.totalExpenses).toBe(55_000) // incluye los reembolsos
    expect(r.overdraft).toBe(0)
  })

  it('un gasto normal (kind expense / sin kind) NO se clasifica como devolución', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('v', 80_000, 'cash')],
      layawayPayments: [],
      expenses: [
        { amount: 20_000 }, // sin kind → 'expense'
        { amount: 30_000, kind: 'expense' as const }, // p. ej. pago a proveedor
      ],
    })
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsIncome).toBe(0)
    expect(r.regularExpensesTotal).toBe(50_000)
    expect(r.totalExpenses).toBe(50_000)
    expect(r.expectedCash).toBe(130_000) // 100k + 80k - 50k
  })

  it('solo reembolso (sin ingreso por cambio)', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('v', 50_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 50_000, kind: 'return' as const }],
    })
    expect(r.returnsIncome).toBe(0)
    expect(r.returnsExpense).toBe(50_000)
    expect(r.returnsNet).toBe(-50_000)
    expect(r.regularSalesTotal).toBe(50_000)
    expect(r.expectedCash).toBe(100_000) // 100k + 50k - 50k
  })

  it('solo ingreso por cambio (sin reembolso)', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('dif', 10_000, 'cash', 'ret-x')],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.returnsIncome).toBe(10_000)
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsNet).toBe(10_000)
    expect(r.regularSalesTotal).toBe(0)
    expect(r.cashSales).toBe(10_000)
    expect(r.expectedCash).toBe(110_000) // 100k + 10k
  })

  it('sin devoluciones: los campos nuevos quedan en 0 (compatibilidad)', () => {
    const r = calculateShiftSummary({
      openingAmount: 50_000,
      orders: [order('v', 30_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 5_000 }],
    })
    expect(r.returnsIncome).toBe(0)
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsNet).toBe(0)
    expect(r.regularExpensesTotal).toBe(5_000)
  })
})
