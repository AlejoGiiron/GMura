// Lógica pura de ventas a crédito (FIADOS). Aislada de los hooks (que hacen las
// queries) para poder testearla sin React ni red. Paralela a layawayCalc.ts.

/** Saldo pendiente de un fiado. Nunca negativo. */
export function creditBalance(total: number, paidAmount: number): number {
  return Math.max(0, Number(total) - Number(paidAmount))
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
