import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { CashShift } from '@/types/database.types'

// Turno actualmente abierto del usuario autenticado. Devuelve null si no hay.
export function useCurrentShift() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const userId = profile?.id ?? ''

  return useQuery<CashShift | null>({
    queryKey: ['cash-shifts', 'current', storeId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_shifts')
        .select('*')
        .eq('store_id' as never, storeId)
        .eq('opened_by' as never, userId)
        .is('closed_at' as never, null)
        .order('opened_at' as never, { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return (data ?? null) as unknown as CashShift | null
    },
    enabled: !!storeId && !!userId,
    staleTime: 30_000,
  })
}

// Suma de ventas en efectivo del usuario actual desde la apertura del turno.
export function useCashShiftSales(opened_at: string | null | undefined) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const userId = profile?.id ?? ''

  return useQuery<number>({
    queryKey: ['cash-shifts', 'sales', storeId, userId, opened_at ?? ''],
    queryFn: async () => {
      if (!opened_at) return 0
      const { data, error } = await supabase
        .from('orders')
        .select('total')
        .eq('store_id' as never, storeId)
        .eq('created_by' as never, userId)
        .eq('payment_method' as never, 'cash')
        .eq('status' as never, 'completed')
        .gte('created_at' as never, opened_at)

      if (error) throw error
      const rows = (data ?? []) as unknown as { total: number | string }[]
      return rows.reduce((sum, o) => sum + Number(o.total), 0)
    },
    enabled: !!storeId && !!userId && !!opened_at,
    staleTime: 5_000,
  })
}
