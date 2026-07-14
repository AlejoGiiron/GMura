import { useCurrentShift } from './useCashShift'
import type { CashShift } from '@/types/database.types'

/**
 * Estado del turno abierto de la tienda activa, para gatear la UX de las
 * operaciones que mueven dinero (fix/shift-guard-ux). Un solo lugar para la
 * pregunta "¿hay turno abierto?" que consumen los modales de pago.
 *
 * La DECISIÓN de si una operación requiere turno vive en shiftGuard.ts
 * (paymentRequiresShift / returnMovesCash); este hook solo expone el estado.
 */
export function useRequireShift(): {
  shift: CashShift | null
  hasShift: boolean
  isLoading: boolean
} {
  const { data: shift, isLoading } = useCurrentShift()
  return { shift: shift ?? null, hasShift: !!shift, isLoading }
}
