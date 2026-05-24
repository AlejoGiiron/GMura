import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CashExpense } from '@/types/database.types'

// Egresos de un turno específico, ordenados del más reciente al más viejo.
export function useShiftExpenses(shiftId: string | null) {
  return useQuery<CashExpense[]>({
    queryKey: ['shift-expenses', shiftId],
    queryFn: async () => {
      if (!shiftId) return []
      const { data, error } = await supabase
        .from('cash_expenses')
        .select('*')
        .eq('shift_id' as never, shiftId)
        .order('created_at' as never, { ascending: false })

      if (error) throw error
      return (data ?? []) as unknown as CashExpense[]
    },
    enabled: !!shiftId,
    staleTime: 30_000,
  })
}

// Conteo de gastos asociados a un motivo (para validar borrado en Config).
export function useExpenseCountByReason(reason: string | null) {
  return useQuery<number>({
    queryKey: ['shift-expenses', 'count-by-reason', reason ?? ''],
    queryFn: async () => {
      if (!reason) return 0
      const { count, error } = await supabase
        .from('cash_expenses')
        .select('id', { count: 'exact', head: true })
        .eq('reason' as never, reason)

      if (error) throw error
      return count ?? 0
    },
    enabled: !!reason,
    staleTime: 30_000,
  })
}
