import type { Layaway } from '@/types/database.types'
import type { StoreConfig } from '@/types/config.types'

const MS_PER_DAY = 86_400_000

/**
 * Calcula el abono inicial mínimo requerido según la configuración de la tienda.
 * Devuelve 0 si la configuración es inválida o el modo es 'none'.
 */
export function calculateRequiredInitialPayment(
  total: number,
  config: Pick<
    StoreConfig,
    'layaway_initial_payment_mode' | 'layaway_initial_payment_value'
  >,
): number {
  if (total <= 0) return 0
  const mode = config.layaway_initial_payment_mode
  const value = config.layaway_initial_payment_value
  if (typeof value !== 'number' || value < 0) return 0
  if (mode === 'fixed') {
    return Math.min(Math.round(value), total)
  }
  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, value))
    return Math.min(Math.round(total * (pct / 100)), total)
  }
  return 0
}

/**
 * Decide cómo imputar un abono de separado a la caja (028).
 *
 * - Abono NORMAL (isHistorical=false): efectivo real que entra ahora → se
 *   imputa al turno abierto (shift_id) para que cuente en el cuadre.
 * - Abono HISTÓRICO (isHistorical=true): dinero recibido ANTES de cargar el
 *   separado → shift_id=null y is_historical=true, para quedar FUERA del
 *   cuadre (evita doble conteo). En ambos casos el trigger suma al saldo.
 */
export function resolveLayawayPaymentImputation(
  isHistorical: boolean,
  currentShiftId: string | null | undefined,
): { shift_id: string | null; is_historical: boolean } {
  if (isHistorical) {
    return { shift_id: null, is_historical: true }
  }
  return { shift_id: currentShiftId ?? null, is_historical: false }
}

/** Devuelve true si el separado venció y sigue activo. */
export function isLayawayOverdue(
  layaway: Pick<Layaway, 'expires_at' | 'status'>,
): boolean {
  if (layaway.status !== 'active') return false
  return new Date(layaway.expires_at).getTime() < Date.now()
}

/**
 * Días entre hoy y expires_at, redondeado hacia abajo. Puede ser negativo
 * cuando el separado ya venció.
 */
export function daysUntilExpiry(
  layaway: Pick<Layaway, 'expires_at'>,
): number {
  const diff = new Date(layaway.expires_at).getTime() - Date.now()
  return Math.floor(diff / MS_PER_DAY)
}
