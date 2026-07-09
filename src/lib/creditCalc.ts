// Lógica pura de ventas a crédito (FIADOS). Aislada de los hooks (que hacen las
// queries) para poder testearla sin React ni red. Paralela a layawayCalc.ts.

/** Saldo pendiente de un fiado. Nunca negativo. */
export function creditBalance(total: number, paidAmount: number): number {
  return Math.max(0, Number(total) - Number(paidAmount))
}

/**
 * Un fiado está SALDADO cuando lo pagado cubre el total (tolerancia 0.5). Se
 * deriva en la UI; NO hay un status nuevo en la BD.
 */
export function isCreditFullyPaid(total: number, paidAmount: number): boolean {
  return Number(paidAmount) + 0.5 >= Number(total)
}

/**
 * Bloqueo de devolución (029): un fiado con SALDO PENDIENTE no se puede devolver
 * por el flujo normal (se gestiona manualmente). Una venta normal, o un fiado ya
 * saldado, no se bloquea. Tolerancia 0.5 por redondeo.
 */
export function isCreditReturnBlocked(order: {
  is_credit: boolean
  total: number
  paid_amount: number
}): boolean {
  return order.is_credit && !isCreditFullyPaid(order.total, order.paid_amount)
}

export type CreditPaymentError = 'nonpositive' | 'exceeds_balance'

/**
 * Valida un abono contra el saldo del fiado. Devuelve el código de error o null.
 * Tolerancia de 0.5 para redondeos (mismo criterio que el completado de separados
 * en useCompleteLayaway).
 */
export function validateCreditPaymentAmount(
  amount: number,
  total: number,
  paidAmount: number,
): CreditPaymentError | null {
  if (!(amount > 0)) return 'nonpositive'
  if (amount > creditBalance(total, paidAmount) + 0.5) return 'exceeds_balance'
  return null
}

/**
 * Imputación de un credit_payment al cuadre (029). Los abonos creados por la app
 * son SIEMPRE efectivo real de ahora → se imputan al turno abierto y NO son
 * históricos. (La carga de fiados viejos con abono histórico, de agregarse,
 * seguiría el patrón de #3C: is_historical=true / shift_id=null.)
 */
export function resolveCreditPaymentImputation(
  currentShiftId: string | null | undefined,
): { shift_id: string | null; is_historical: boolean } {
  return { shift_id: currentShiftId ?? null, is_historical: false }
}
