import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { CashShift } from '@/types/database.types'

// Turno actualmente abierto de la TIENDA activa. Devuelve null si no hay.
// El turno es COMPARTIDO por tienda (026): ya no se filtra por opened_by, así
// que cualquier usuario de la tienda ve y opera el mismo turno. El índice único
// parcial uq_cash_shifts_one_open_per_store garantiza que haya a lo sumo uno;
// el order/limit(1) es robustez ante datos legacy.
export function useCurrentShift() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CashShift | null>({
    queryKey: ['cash-shifts', 'current', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_shifts')
        .select('*')
        .eq('store_id' as never, storeId)
        .is('closed_at' as never, null)
        .order('opened_at' as never, { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as unknown as CashShift | null
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// Suma de ventas en efectivo del TURNO (de cualquier usuario de la tienda),
// imputadas por shift_id (026). El turno actual es siempre posterior al deploy,
// así que sus órdenes llevan shift_id; no requiere fallback por tiempo.
export function useCashShiftSales(shift_id: string | null | undefined) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<number>({
    queryKey: ['cash-shifts', 'sales', storeId, shift_id ?? ''],
    queryFn: async () => {
      if (!shift_id) return 0
      const { data, error } = await supabase
        .from('orders')
        .select('total')
        .eq('store_id' as never, storeId)
        .eq('shift_id' as never, shift_id)
        .eq('payment_method' as never, 'cash')
        .eq('status' as never, 'completed')

      if (error) throw error
      const rows = (data ?? []) as unknown as { total: number | string }[]
      return rows.reduce((sum, o) => sum + Number(o.total), 0)
    },
    enabled: !!storeId && !!shift_id,
    staleTime: 5_000,
  })
}
