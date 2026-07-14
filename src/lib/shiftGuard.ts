// Guard de turno para operaciones que MUEVEN DINERO (fix/require-shift-for-money).
//
// Problema que resuelve: varias mutations registraban dinero con shift_id NULL
// cuando no había turno abierto (useCurrentShift → undefined). Ese dinero cae
// fuera de TODO cuadre: el fallback legacy de useShiftClosing solo reconstruye
// por ventana+cajero cuando el turno no tiene NINGUNA fila con shift_id, así que
// un movimiento suelto con shift_id NULL nunca lo absorbe nadie.
//
// Lógica pura (sin React ni red) para poder testear el guard aislado, siguiendo
// el patrón del proyecto (shiftCalc, returnCalc, layawayCalc, creditCalc).

export const REQUIRE_SHIFT_MESSAGE =
  'Debes abrir un turno para registrar este pago'

/**
 * Exige un turno abierto para imputar un pago al cuadre. Lanza si no lo hay.
 *
 * EXCEPCIÓN #3C — pagos HISTÓRICOS (is_historical=true): dinero recibido ANTES
 * de cargar el separado/fiado. Por diseño van con shift_id NULL y quedan fuera
 * del cuadre (no son ingreso de este turno). El guard NO debe bloquearlos.
 */
export function assertShiftForPayment(
  currentShiftId: string | null | undefined,
  opts: { isHistorical?: boolean } = {},
): void {
  if (opts.isHistorical === true) return
  if (!currentShiftId) {
    throw new Error(REQUIRE_SHIFT_MESSAGE)
  }
}

/**
 * ¿Este pago requiere turno abierto? Versión BOOLEANA de assertShiftForPayment
 * (misma decisión, sin lanzar) para la UX: decidir si deshabilitar el botón y
 * mostrar el aviso ANTES de intentar. Un pago histórico (#3C) no lo requiere.
 */
export function paymentRequiresShift(
  opts: { isHistorical?: boolean } = {},
): boolean {
  return opts.isHistorical !== true
}

/**
 * ¿Una devolución/cambio MUEVE efectivo del cajón o cobra una diferencia?
 *
 * - Reembolso en efectivo (> 0): sale plata → exige turno para registrar el
 *   egreso (si no, sale del cajón sin traza — faltante fantasma).
 * - Cambio que cobra diferencia (orderTotal > 0): entra plata → exige turno
 *   para imputar el ingreso.
 * - Cambio del mismo valor o reembolso NO-efectivo (transferencia/tarjeta): no
 *   toca el cajón → puede registrarse sin turno.
 */
export function returnMovesCash(params: {
  type: 'return' | 'exchange'
  refundMethod: string
  // Valor devuelto al cliente en una devolución pura (Σ unit_price·qty).
  returnedValue: number
  // Diferencia a favor del cliente en un cambio más barato (exchange.refundDue).
  exchangeRefundDue: number
  // Diferencia a cobrar en un cambio más caro (exchange.orderTotal).
  exchangeCharge: number
}): boolean {
  const cashRefund =
    params.refundMethod === 'cash' &&
    (params.type === 'exchange'
      ? params.exchangeRefundDue
      : params.returnedValue) > 0
  const chargesDifference =
    params.type === 'exchange' && params.exchangeCharge > 0
  return cashRefund || chargesDifference
}
