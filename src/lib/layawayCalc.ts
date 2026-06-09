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
 * Descuento máximo permitido sobre un subtotal. El descuento de separados es
 * LIBRE (sin tope configurado): si está permitido (mode 'fixed'), el único
 * límite lógico es el propio subtotal; si no está permitido ('none'), es 0.
 */
export function calculateMaxDiscount(
  subtotal: number,
  config: Pick<StoreConfig, 'layaway_discount_mode'>,
): number {
  if (subtotal <= 0) return 0
  return config.layaway_discount_mode === 'fixed' ? subtotal : 0
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
