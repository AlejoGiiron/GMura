import type { PaymentMethod } from '@/types/database.types'

// Lógica pura de cálculo del cuadre de caja. Aislada del hook useShiftClosing
// (que solo hace las queries) para poder testearla sin React ni red.

export interface SalesByMethod {
  method: PaymentMethod
  count: number
  total: number
  regularTotal: number
  layawayTotal: number
}

export interface ShiftOrderInput {
  id: string
  total: number
  payment_method: PaymentMethod
  // Si la orden es la diferencia cobrada en un cambio, apunta a la devolución.
  // Esas órdenes son INGRESO por devolución → se muestran aparte, no en ventas.
  return_id?: string | null
}

export interface ShiftLayawayPaymentInput {
  payment_method: PaymentMethod
  amount: number
}

export interface ShiftExpenseInput {
  amount: number
  // 'return' = reembolso de una devolución; 'expense' (default) = gasto normal.
  kind?: 'expense' | 'return'
}

export interface ShiftSummaryInput {
  openingAmount: number
  orders: ShiftOrderInput[]
  // Ids de órdenes generadas al COMPLETAR un separado. Se excluyen del cuadre
  // porque cada abono del separado ya se contó como ingreso el día que se
  // cobró; contar además la orden de cierre duplicaría el dinero.
  excludedOrderIds?: Iterable<string>
  layawayPayments: ShiftLayawayPaymentInput[]
  expenses: ShiftExpenseInput[]
}

export interface ShiftSummary {
  salesByMethod: SalesByMethod[]
  regularSalesTotal: number
  layawayPaymentsTotal: number
  totalSales: number
  cashSales: number
  totalExpenses: number
  // Efectivo esperado en caja (tope en 0, Lógica B). Si los egresos superan lo
  // disponible, el faltante se reporta en `overdraft` en vez de un esperado
  // negativo.
  expectedCash: number
  overdraft: number
  orderCount: number
  // ── Devoluciones (solo presentación; NO afectan expectedCash) ──────────────
  // Ingreso por devoluciones = órdenes con return_id (diferencia cobrada en un
  // cambio); su efectivo YA está dentro de cashSales.
  returnsIncome: number
  // Reembolsos = cash_expenses kind='return'; su monto YA está en totalExpenses.
  returnsExpense: number
  returnsNet: number
  // Egresos "regulares" para mostrar (totalExpenses menos los reembolsos).
  regularExpensesTotal: number
}

export interface CashReconciliation {
  expectedCash: number
  overdraft: number
}

/**
 * Lógica B del cuadre: el efectivo esperado nunca baja de 0. Cuando los egresos
 * superan el efectivo disponible (apertura + ventas/abonos en efectivo) el
 * exceso se reporta como `overdraft` (sobregiro), no como un esperado negativo.
 */
export function reconcileCash(
  availableCash: number,
  totalExpenses: number,
): CashReconciliation {
  return {
    expectedCash: Math.max(0, availableCash - totalExpenses),
    overdraft: Math.max(0, totalExpenses - availableCash),
  }
}

/**
 * Diferencia del cuadre = contado − esperado − sobregiro. Positiva = SOBRANTE,
 * negativa = FALTANTE, cero = CUADRADO. Restar el sobregiro asegura que un
 * egreso que vacía la caja se lea como faltante y no como sobrante.
 */
export function shiftDifference(
  countedCash: number,
  rec: CashReconciliation,
): number {
  return countedCash - rec.expectedCash - rec.overdraft
}

type AggRow = {
  count: number
  total: number
  regularTotal: number
  layawayTotal: number
}

const emptyAgg = (): AggRow => ({
  count: 0,
  total: 0,
  regularTotal: 0,
  layawayTotal: 0,
})

/**
 * Calcula el resumen del cuadre de un turno a partir de las ventas, los abonos
 * de separados y los egresos. Solo el efectivo afecta `expectedCash`:
 *   expectedCash = apertura + ventas efectivo + abonos efectivo - egresos
 */
export function calculateShiftSummary(input: ShiftSummaryInput): ShiftSummary {
  const excluded = new Set(input.excludedOrderIds ?? [])
  const orders = input.orders.filter((o) => !excluded.has(o.id))

  const aggMap = new Map<PaymentMethod, AggRow>()
  let regularSalesTotal = 0
  let layawayPaymentsTotal = 0
  let cashSales = 0
  let returnsIncome = 0
  let regularOrderCount = 0

  for (const o of orders) {
    const t = o.total
    // Todo el efectivo cuenta para el cuadre (incluido el ingreso por cambio),
    // por eso cashSales NO se ve afectado por la clasificación → expectedCash
    // queda idéntico.
    if (o.payment_method === 'cash') cashSales += t

    if (o.return_id) {
      // Ingreso por devolución (diferencia de cambio): se muestra aparte, no
      // entra a ventas regulares ni a salesByMethod.
      returnsIncome += t
      continue
    }

    regularOrderCount += 1
    regularSalesTotal += t
    const prev = aggMap.get(o.payment_method) ?? emptyAgg()
    aggMap.set(o.payment_method, {
      count: prev.count + 1,
      total: prev.total + t,
      regularTotal: prev.regularTotal + t,
      layawayTotal: prev.layawayTotal,
    })
  }

  for (const p of input.layawayPayments) {
    const t = p.amount
    layawayPaymentsTotal += t
    if (p.payment_method === 'cash') cashSales += t
    const prev = aggMap.get(p.payment_method) ?? emptyAgg()
    aggMap.set(p.payment_method, {
      count: prev.count + 1,
      total: prev.total + t,
      regularTotal: prev.regularTotal,
      layawayTotal: prev.layawayTotal + t,
    })
  }

  const salesByMethod: SalesByMethod[] = Array.from(aggMap.entries())
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.total - a.total)

  const totalSales = regularSalesTotal + layawayPaymentsTotal

  // Egresos: el total (para el cuadre) es TODO; los reembolsos se separan solo
  // para la presentación. totalExpenses NO cambia → expectedCash idéntico.
  let totalExpenses = 0
  let returnsExpense = 0
  for (const e of input.expenses) {
    totalExpenses += e.amount
    if (e.kind === 'return') returnsExpense += e.amount
  }
  const regularExpensesTotal = totalExpenses - returnsExpense

  const { expectedCash, overdraft } = reconcileCash(
    input.openingAmount + cashSales,
    totalExpenses,
  )

  return {
    salesByMethod,
    regularSalesTotal,
    layawayPaymentsTotal,
    totalSales,
    cashSales,
    totalExpenses,
    expectedCash,
    overdraft,
    orderCount: regularOrderCount,
    returnsIncome,
    returnsExpense,
    returnsNet: returnsIncome - returnsExpense,
    regularExpensesTotal,
  }
}
