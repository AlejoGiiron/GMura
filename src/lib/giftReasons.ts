/**
 * Motivos de REGALO (ítem $0 marcado como cortesía en el POS).
 *
 * Los `value` DEBEN coincidir exactamente con la lista cerrada del CHECK
 * `order_items_gift_coherent` de la migración 027_gift_items.sql:
 *   ('regalo', 'muestra', 'promocion', 'compensacion')
 * Si acá se agrega/quita un motivo, hay que actualizar también ese CHECK.
 *
 * Fuente única reutilizable: la usa el selector del carrito, el store y
 * (a futuro) los reportes que desglosen regalos por motivo.
 */

export interface GiftReasonDef {
  value: string
  label: string
}

export const GIFT_REASONS: GiftReasonDef[] = [
  { value: 'regalo', label: 'Regalo' },
  { value: 'muestra', label: 'Muestra' },
  { value: 'promocion', label: 'Promoción' },
  { value: 'compensacion', label: 'Compensación' },
]

/** Solo los valores (para validar contra la lista del CHECK). */
export const GIFT_REASON_VALUES: string[] = GIFT_REASONS.map((r) => r.value)

/** Etiqueta en español de un motivo; '' si es null o desconocido. */
export function giftReasonLabel(value: string | null): string {
  return GIFT_REASONS.find((r) => r.value === value)?.label ?? ''
}

/** True si `value` es uno de los motivos válidos (no null, en la lista). */
export function isValidGiftReason(value: string | null): value is string {
  return value !== null && GIFT_REASON_VALUES.includes(value)
}
