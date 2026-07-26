import type { PaymentMethod } from '@/types/database.types'

// Lógica pura de cálculo del cuadre de caja. Aislada del hook useShiftClosing
// (que solo hace las queries) para poder testearla sin React ni red.

export interface SalesByMethod {
  method: PaymentMethod
  count: number
  total: number
  regularTotal: number
  layawayTotal: number
  // Abonos de FIADO (029) cobrados en este método. Parte del efectivo del
  // cuadre; el revenue del fiado ya se reconoció en la orden (reportes).
  creditTotal: number
}

export interface OrderPaymentInput {
  method: PaymentMethod
  amount: number
}

export interface ShiftOrderInput {
  id: string
  total: number
  // Desglose de pagos de la venta (order_payments, 032). Una venta de un solo
  // método trae UNA fila; una venta MIXTA, varias. La suma de amount = total
  // (paridad garantizada por el backfill/escritura). Antes había un único
  // payment_method; ahora el cuadre suma por método desde estas filas. Los
  // fiados no traen filas (su efectivo entra por creditPayments) y además la
  // orden fiada ya se excluye aguas arriba, así que nunca llega acá.
  payments: OrderPaymentInput[]
  // Si la orden es la diferencia cobrada en un cambio, apunta a la devolución.
  // Esas órdenes son INGRESO por devolución → se muestran aparte, no en ventas.
  return_id?: string | null
}

export interface ShiftLayawayPaymentInput {
  payment_method: PaymentMethod
  amount: number
}

// Abono de una venta FIADA (029). Efectivo real cobrado ahora; se suma al
// cuadre igual que un abono de separado. Su orden (is_credit) se EXCLUYE del
// efectivo (su total no entró), por eso el abono no duplica.
export interface ShiftCreditPaymentInput {
  payment_method: PaymentMethod
  amount: number
}

export interface ShiftExpenseInput {
  amount: number
  // 'return' = reembolso de una devolución; 'expense' (default) = gasto normal.
  kind?: 'expense' | 'return'
  // Cómo se pagó el egreso (037). Solo 'cash' sale del cajón y afecta el
  // efectivo esperado; 'card'/'transfer' son gasto del negocio pero no de la
  // caja. Default 'cash': así se contaba TODO antes de la 037, así que los
  // call sites y tests previos dan el mismo resultado.
  payment_method?: 'cash' | 'card' | 'transfer'
}

export interface ShiftSummaryInput {
  openingAmount: number
  orders: ShiftOrderInput[]
  // Ids de órdenes generadas al COMPLETAR un separado. Se excluyen del cuadre
  // porque cada abono del separado ya se contó como ingreso el día que se
  // cobró; contar además la orden de cierre duplicaría el dinero.
  excludedOrderIds?: Iterable<string>
  layawayPayments: ShiftLayawayPaymentInput[]
  // Abonos de fiados imputados al turno. Opcional para compatibilidad con los
  // call sites/tests previos a fiados (default []).
  creditPayments?: ShiftCreditPaymentInput[]
  expenses: ShiftExpenseInput[]
}

export interface ShiftSummary {
  salesByMethod: SalesByMethod[]
  regularSalesTotal: number
  layawayPaymentsTotal: number
  // Total de abonos de fiado del turno (parte del efectivo; NO revenue).
  creditPaymentsTotal: number
  totalSales: number
  cashSales: number
  // TODOS los egresos del turno (cualquier método). Es el gasto del negocio;
  // sirve para mostrar, NO para el cuadre.
  totalExpenses: number
  // Egresos pagados en EFECTIVO: los únicos que salen del cajón y por lo tanto
  // los únicos que se restan del efectivo esperado (037).
  cashExpensesTotal: number
  // Egresos por otro medio (tarjeta/transferencia): se registran y se muestran,
  // pero no tocan la caja. totalExpenses = cashExpensesTotal + nonCashExpensesTotal.
  nonCashExpensesTotal: number
  // Efectivo esperado en caja (tope en 0, Lógica B). Si los egresos EN EFECTIVO
  // superan lo disponible, el faltante se reporta en `overdraft` en vez de un
  // esperado negativo.
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
  // Idem pero solo los pagados en efectivo (los que el cuadre resta).
  regularCashExpensesTotal: number
}

export interface CashReconciliation {
  expectedCash: number
  overdraft: number
}

/**
 * Lógica B del cuadre: el efectivo esperado nunca baja de 0. Cuando los egresos
 * superan el efectivo disponible (apertura + ventas/abonos en efectivo) el
 * exceso se reporta como `overdraft` (sobregiro), no como un esperado negativo.
 *
 * `cashExpenses` son SOLO los egresos pagados en efectivo (037): un gasto por
 * transferencia no sale del cajón, así que no puede bajar el esperado.
 */
export function reconcileCash(
  availableCash: number,
  cashExpenses: number,
): CashReconciliation {
  return {
    expectedCash: Math.max(0, availableCash - cashExpenses),
    overdraft: Math.max(0, cashExpenses - availableCash),
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
  creditTotal: number
}

const emptyAgg = (): AggRow => ({
  count: 0,
  total: 0,
  regularTotal: 0,
  layawayTotal: 0,
  creditTotal: 0,
})

/**
 * Calcula el resumen del cuadre de un turno a partir de las ventas, los abonos
 * de separados y los egresos. Solo el efectivo afecta `expectedCash`, en ambos
 * lados de la resta:
 *   expectedCash = apertura + ventas efectivo + abonos efectivo - egresos efectivo
 */
export function calculateShiftSummary(input: ShiftSummaryInput): ShiftSummary {
  const excluded = new Set(input.excludedOrderIds ?? [])
  const orders = input.orders.filter((o) => !excluded.has(o.id))

  const aggMap = new Map<PaymentMethod, AggRow>()
  let regularSalesTotal = 0
  let layawayPaymentsTotal = 0
  let creditPaymentsTotal = 0
  let cashSales = 0
  let returnsIncome = 0
  let regularOrderCount = 0

  for (const o of orders) {
    // El efectivo de la orden = suma de sus pagos en efectivo (antes: el total
    // si payment_method==='cash'). Cuenta para el cuadre aunque la orden sea el
    // ingreso por un cambio (return_id) → expectedCash queda idéntico.
    for (const p of o.payments) {
      if (p.method === 'cash') cashSales += p.amount
    }

    if (o.return_id) {
      // Ingreso por devolución (diferencia de cambio): se muestra aparte, no
      // entra a ventas regulares ni a salesByMethod.
      returnsIncome += o.total
      continue
    }

    regularOrderCount += 1
    regularSalesTotal += o.total
    // Una fila de salesByMethod por cada pago: una venta mixta aporta a varios
    // métodos. Para una venta de un solo método equivale a leer el
    // payment_method anterior (un único pago cuyo monto = el total).
    for (const p of o.payments) {
      const prev = aggMap.get(p.method) ?? emptyAgg()
      aggMap.set(p.method, {
        count: prev.count + 1,
        total: prev.total + p.amount,
        regularTotal: prev.regularTotal + p.amount,
        layawayTotal: prev.layawayTotal,
        creditTotal: prev.creditTotal,
      })
    }
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
      creditTotal: prev.creditTotal,
    })
  }

  // Abonos de FIADO (029): efectivo real cobrado ahora. Se suman al cuadre
  // igual que los de separado. La ORDEN fiada se excluyó del efectivo aguas
  // arriba (query .eq('is_credit', false)), así que esto no duplica.
  for (const p of input.creditPayments ?? []) {
    const t = p.amount
    creditPaymentsTotal += t
    if (p.payment_method === 'cash') cashSales += t
    const prev = aggMap.get(p.payment_method) ?? emptyAgg()
    aggMap.set(p.payment_method, {
      count: prev.count + 1,
      total: prev.total + t,
      regularTotal: prev.regularTotal,
      layawayTotal: prev.layawayTotal,
      creditTotal: prev.creditTotal + t,
    })
  }

  const salesByMethod: SalesByMethod[] = Array.from(aggMap.entries())
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.total - a.total)

  const totalSales = regularSalesTotal + layawayPaymentsTotal + creditPaymentsTotal

  // Egresos: `totalExpenses` es TODO el gasto del turno (para mostrar), pero el
  // CUADRE solo puede restar lo que salió del cajón → cashExpensesTotal (037).
  // Un gasto por transferencia queda registrado y visible, sin generar un
  // faltante falso. Los reembolsos de devolución se separan aparte para la
  // presentación (siempre son en efectivo: solo se registran en ese caso).
  let totalExpenses = 0
  let cashExpensesTotal = 0
  let returnsExpense = 0
  let regularCashExpensesTotal = 0
  for (const e of input.expenses) {
    const isCash = (e.payment_method ?? 'cash') === 'cash'
    totalExpenses += e.amount
    if (isCash) cashExpensesTotal += e.amount
    if (e.kind === 'return') {
      returnsExpense += e.amount
    } else if (isCash) {
      regularCashExpensesTotal += e.amount
    }
  }
  const regularExpensesTotal = totalExpenses - returnsExpense
  const nonCashExpensesTotal = totalExpenses - cashExpensesTotal

  const { expectedCash, overdraft } = reconcileCash(
    input.openingAmount + cashSales,
    cashExpensesTotal,
  )

  return {
    salesByMethod,
    regularSalesTotal,
    layawayPaymentsTotal,
    creditPaymentsTotal,
    totalSales,
    cashSales,
    totalExpenses,
    cashExpensesTotal,
    nonCashExpensesTotal,
    expectedCash,
    overdraft,
    orderCount: regularOrderCount,
    returnsIncome,
    returnsExpense,
    returnsNet: returnsIncome - returnsExpense,
    regularExpensesTotal,
    regularCashExpensesTotal,
  }
}
