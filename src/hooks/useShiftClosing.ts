import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { calculateShiftSummary, type SalesByMethod } from '@/lib/shiftCalc'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type { SalesByMethod }

export interface LayawayPaymentRow {
  id: string
  layaway_number: number
  amount: number
  payment_method: PaymentMethod
  created_at: string
}

export interface ShiftClosingData {
  shift: CashShift
  expenses: CashExpense[]
  salesByMethod: SalesByMethod[]
  totalSales: number
  cashSales: number
  totalExpenses: number
  expectedCash: number
  overdraft: number
  orderCount: number
  layawayPayments: LayawayPaymentRow[]
  layawayPaymentsTotal: number
  regularSalesTotal: number
  storeName: string
  userName: string
}

type RawOrder = {
  id: string
  total: number | string
  payment_method: PaymentMethod
}

type RawLayawayPayment = {
  id: string
  amount: number | string
  payment_method: PaymentMethod
  created_at: string
  layaways: { layaway_number: number } | null
}

type RawConvertedOrder = {
  converted_order_id: string | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useShiftClosing(shiftId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

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

      // 1. IDs de órdenes generadas al completar separados dentro de la ventana
      //    del turno. Estas órdenes se EXCLUYEN del cuadre porque cada abono
      //    individual del separado ya cuenta como ingreso del día que se cobró.
      let cQuery = supabase
        .from('layaways')
        .select('converted_order_id')
        .eq('store_id' as never, storeId)
        .not('converted_order_id' as never, 'is', null)
        .gte('completed_at' as never, shift.opened_at)
      if (shift.closed_at) {
        cQuery = cQuery.lte('completed_at' as never, shift.closed_at)
      }
      const { data: convRaw, error: convErr } = await cQuery
      if (convErr) throw convErr

      const excludedOrderIds = new Set(
        ((convRaw ?? []) as unknown as RawConvertedOrder[])
          .map((r) => r.converted_order_id)
          .filter((id): id is string => !!id),
      )

      // 2. Órdenes del turno (excluyendo las generadas por completar separados)
      let oQuery = supabase
        .from('orders')
        .select('id, total, payment_method')
        .eq('store_id' as never, storeId)
        .eq('created_by' as never, shift.opened_by)
        .eq('status' as never, 'completed')
        .gte('created_at' as never, shift.opened_at)

      if (shift.closed_at) {
        oQuery = oQuery.lte('created_at' as never, shift.closed_at)
      }

      const { data: orders, error: ordersErr } = await oQuery
      if (ordersErr) throw ordersErr

      // 3. Abonos de separados del turno
      let pQuery = supabase
        .from('layaway_payments')
        .select(
          `id, amount, payment_method, created_at,
           layaways:layaway_id(layaway_number)`,
        )
        .eq('store_id' as never, storeId)
        .eq('created_by' as never, shift.opened_by)
        .gte('created_at' as never, shift.opened_at)

      if (shift.closed_at) {
        pQuery = pQuery.lte('created_at' as never, shift.closed_at)
      }

      const { data: paymentsRaw, error: paymentsErr } = await pQuery
        .order('created_at' as never, { ascending: true })
      if (paymentsErr) throw paymentsErr

      const layawayPayments: LayawayPaymentRow[] = (
        (paymentsRaw ?? []) as unknown as RawLayawayPayment[]
      ).map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        payment_method: p.payment_method,
        created_at: p.created_at,
        layaway_number: p.layaways?.layaway_number ?? 0,
      }))

      // 4. Egresos del turno
      const { data: expensesRaw, error: expErr } = await supabase
        .from('cash_expenses')
        .select('*')
        .eq('shift_id' as never, shiftId)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: true })

      if (expErr) throw expErr
      const expenses = (expensesRaw ?? []) as unknown as CashExpense[]

      // 5. Agregación pura del cuadre (orders + abonos - egresos). La función
      //    excluye las órdenes generadas al completar separados para no contar
      //    dos veces el dinero.
      const summary = calculateShiftSummary({
        openingAmount: shift.opening_amount,
        orders: ((orders ?? []) as unknown as RawOrder[]).map((o) => ({
          id: o.id,
          total: Number(o.total),
          payment_method: o.payment_method,
        })),
        excludedOrderIds,
        layawayPayments,
        expenses: expenses.map((e) => ({ amount: Number(e.amount) })),
      })

      return {
        shift,
        expenses,
        salesByMethod: summary.salesByMethod,
        totalSales: summary.totalSales,
        cashSales: summary.cashSales,
        totalExpenses: summary.totalExpenses,
        expectedCash: summary.expectedCash,
        overdraft: summary.overdraft,
        orderCount: summary.orderCount,
        layawayPayments,
        layawayPaymentsTotal: summary.layawayPaymentsTotal,
        regularSalesTotal: summary.regularSalesTotal,
        storeName,
        userName,
      }
    },
    enabled: !!shiftId && !!storeId,
    staleTime: 15_000,
  })
}
