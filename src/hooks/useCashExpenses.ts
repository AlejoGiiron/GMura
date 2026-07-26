import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { bogotaDayStartToUtc, bogotaDayEndToUtc } from '@/lib/dates'
import type {
  CashExpense,
  ExpensePaymentMethod,
} from '@/types/database.types'

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

// ── Historial de gastos (admin) ───────────────────────────────────────────────

export interface ExpenseHistoryFilters {
  dateFrom: string
  dateTo: string
}

export interface ExpenseHistoryRow {
  id: string
  created_at: string
  reason: string
  notes: string | null
  amount: number
  // Cómo se pagó (037). Solo 'cash' afectó el cuadre del turno.
  payment_method: ExpensePaymentMethod
  shift_id: string
  created_by: string
  cashierName: string
}

type RawExpenseRow = {
  id: string
  created_at: string
  reason: string
  notes: string | null
  amount: number | string
  payment_method: ExpensePaymentMethod | null
  shift_id: string
  created_by: string
  profiles: { full_name: string } | null
}

// Historial de gastos de la tienda ACTIVA en un rango de fechas. Solo
// kind = 'expense' (excluye reembolsos de devolución, que son kind = 'return').
// Incluye gastos manuales y pagos a proveedor en efectivo (ambos kind='expense').
// La agregación (total + desglose por motivo) y el filtro por motivo se hacen
// en el cliente sobre este conjunto, que es acotado por el rango de fechas.
export function useExpenseHistory(filters: ExpenseHistoryFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<ExpenseHistoryRow[]>({
    queryKey: ['expense-history', storeId, filters],
    queryFn: async () => {
      let q = supabase
        .from('cash_expenses')
        .select(
          'id, created_at, reason, notes, amount, payment_method, shift_id, created_by, profiles:created_by(full_name)',
        )
        .eq('store_id' as never, storeId)
        .eq('kind' as never, 'expense')
        .order('created_at' as never, { ascending: false })

      // created_at se guarda en UTC; convertimos los límites de la fecha civil
      // de Bogotá a UTC para no excluir gastos registrados de noche.
      if (filters.dateFrom) {
        q = q.gte('created_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        q = q.lte('created_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { data, error } = await q
      if (error) throw error

      return ((data ?? []) as unknown as RawExpenseRow[]).map((e) => ({
        id: e.id,
        created_at: e.created_at,
        reason: e.reason,
        notes: e.notes,
        amount: Number(e.amount),
        // Las filas previas a la 037 quedaron en 'cash' por DEFAULT; el ?? es
        // defensa por si la columna aún no existe en el entorno.
        payment_method: e.payment_method ?? 'cash',
        shift_id: e.shift_id,
        created_by: e.created_by,
        cashierName: e.profiles?.full_name ?? 'Usuario',
      }))
    },
    enabled: !!storeId,
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
