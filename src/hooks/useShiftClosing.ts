import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SalesByMethod {
  method: PaymentMethod
  count: number
  total: number
}

export interface ShiftClosingData {
  shift: CashShift
  expenses: CashExpense[]
  salesByMethod: SalesByMethod[]
  totalSales: number
  cashSales: number
  totalExpenses: number
  expectedCash: number
  orderCount: number
  avgTicket: number
  storeName: string
  userName: string
}

type RawOrder = {
  total: number | string
  payment_method: PaymentMethod
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useShiftClosing(shiftId: string | null) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery<ShiftClosingData | null>({
    queryKey: ['shift-closing', shiftId, storeId],
    queryFn: async () => {
      if (!shiftId) return null

      const { data: shiftRaw, error: shiftErr } = await supabase
        .from('cash_shifts')
        .select(
          `id, store_id, opened_by, closed_by, opening_amount,
           closing_amount, opened_at, closed_at, updated_at,
           profiles:opened_by(full_name),
           stores:store_id(name)`,
        )
        .eq('id' as never, shiftId)
        .eq('store_id' as never, storeId)
        .single()

      if (shiftErr || !shiftRaw) {
        throw new Error(shiftErr?.message ?? 'No se pudo cargar el turno')
      }

      type RawShift = CashShift & {
        profiles: { full_name: string } | null
        stores: { name: string } | null
      }
      const shiftJoin = shiftRaw as unknown as RawShift
      const userName = shiftJoin.profiles?.full_name ?? 'Cajero'
      const storeName = shiftJoin.stores?.name ?? 'G-Mura'

      const shift: CashShift = {
        id: shiftJoin.id,
        store_id: shiftJoin.store_id,
        opened_by: shiftJoin.opened_by,
        closed_by: shiftJoin.closed_by,
        opening_amount: Number(shiftJoin.opening_amount),
        closing_amount:
          shiftJoin.closing_amount != null
            ? Number(shiftJoin.closing_amount)
            : null,
        opened_at: shiftJoin.opened_at,
        closed_at: shiftJoin.closed_at,
        updated_at: shiftJoin.updated_at,
      }

      // Órdenes del turno: por created_by + ventana de tiempo.
      let oQuery = supabase
        .from('orders')
        .select('total, payment_method')
        .eq('store_id' as never, storeId)
        .eq('created_by' as never, shift.opened_by)
        .eq('status' as never, 'completed')
        .gte('created_at' as never, shift.opened_at)

      if (shift.closed_at) {
        oQuery = oQuery.lte('created_at' as never, shift.closed_at)
      }

      const { data: orders, error: ordersErr } = await oQuery
      if (ordersErr) throw ordersErr

      const aggMap = new Map<PaymentMethod, { count: number; total: number }>()
      let totalSales = 0
      let cashSales = 0
      for (const row of (orders ?? []) as unknown as RawOrder[]) {
        const t = Number(row.total)
        totalSales += t
        if (row.payment_method === 'cash') cashSales += t
        const prev = aggMap.get(row.payment_method) ?? { count: 0, total: 0 }
        aggMap.set(row.payment_method, {
          count: prev.count + 1,
          total: prev.total + t,
        })
      }

      const salesByMethod: SalesByMethod[] = Array.from(aggMap.entries())
        .map(([method, v]) => ({ method, count: v.count, total: v.total }))
        .sort((a, b) => b.total - a.total)

      const orderCount = (orders ?? []).length
      const avgTicket = orderCount > 0 ? totalSales / orderCount : 0

      // Egresos del turno
      const { data: expensesRaw, error: expErr } = await supabase
        .from('cash_expenses')
        .select('*')
        .eq('shift_id' as never, shiftId)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: true })

      if (expErr) throw expErr
      const expenses = (expensesRaw ?? []) as unknown as CashExpense[]
      const totalExpenses = expenses.reduce(
        (sum, e) => sum + Number(e.amount),
        0,
      )

      const expectedCash = shift.opening_amount + cashSales - totalExpenses

      return {
        shift,
        expenses,
        salesByMethod,
        totalSales,
        cashSales,
        totalExpenses,
        expectedCash,
        orderCount,
        avgTicket,
        storeName,
        userName,
      }
    },
    enabled: !!shiftId && !!storeId,
    staleTime: 15_000,
  })
}
