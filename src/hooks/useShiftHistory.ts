import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { bogotaDayStartToUtc, bogotaDayEndToUtc } from '@/lib/dates'
import { reconcileCash, shiftDifference } from '@/lib/shiftCalc'
import type { CashShift, Profile } from '@/types/database.types'

export const SHIFT_HISTORY_PAGE_SIZE = 50

export interface ShiftHistoryFilters {
  cashierId: string | 'all'
  dateFrom: string
  dateTo: string
  page: number
}

export interface ShiftHistoryRow {
  shift: CashShift
  cashierName: string
  cashSales: number
  totalExpenses: number
  expectedCash: number
  overdraft: number
  countedCash: number
  difference: number
}

export interface ShiftHistoryResult {
  rows: ShiftHistoryRow[]
  totalCount: number
  page: number
  pageSize: number
}

type RawShift = CashShift & {
  profiles: { full_name: string } | null
}

// ── Lista paginada de turnos cerrados ─────────────────────────────────────────

export function useShiftHistory(filters: ShiftHistoryFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<ShiftHistoryResult>({
    queryKey: ['shift-history', storeId, filters],
    queryFn: async () => {
      const from = filters.page * SHIFT_HISTORY_PAGE_SIZE
      const to = from + SHIFT_HISTORY_PAGE_SIZE - 1

      let q = supabase
        .from('cash_shifts')
        .select(
          `id, store_id, opened_by, closed_by, opening_amount,
           closing_amount, opened_at, closed_at, updated_at,
           profiles:opened_by(full_name)`,
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)
        .not('closed_at' as never, 'is', null)
        .order('closed_at' as never, { ascending: false })
        .range(from, to)

      if (filters.cashierId !== 'all') {
        q = q.eq('opened_by' as never, filters.cashierId)
      }
      // closed_at se guarda en UTC; convertimos los límites de la fecha civil
      // de Bogotá a UTC para no excluir turnos cerrados de noche.
      if (filters.dateFrom) {
        q = q.gte('closed_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        q = q.lte('closed_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { data, error, count } = await q
      if (error) throw error

      const shiftsRaw = (data ?? []) as unknown as RawShift[]
      if (shiftsRaw.length === 0) {
        return {
          rows: [],
          totalCount: count ?? 0,
          page: filters.page,
          pageSize: SHIFT_HISTORY_PAGE_SIZE,
        }
      }

      // Aggregamos ventas en efectivo y egresos por turno con 2 consultas.
      const shiftIds = shiftsRaw.map((s) => s.id)
      const ownerByShift = new Map<string, { opened_by: string; opened_at: string; closed_at: string | null }>()
      for (const s of shiftsRaw) {
        ownerByShift.set(s.id, {
          opened_by: s.opened_by,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
        })
      }

      const { data: expensesRaw, error: expErr } = await supabase
        .from('cash_expenses')
        .select('shift_id, amount')
        .in('shift_id' as never, shiftIds)
        .eq('store_id' as never, storeId)
      if (expErr) throw expErr

      const expByShift = new Map<string, number>()
      for (const e of (expensesRaw ?? []) as unknown as {
        shift_id: string
        amount: number | string
      }[]) {
        expByShift.set(
          e.shift_id,
          (expByShift.get(e.shift_id) ?? 0) + Number(e.amount),
        )
      }

      // Para cashSales necesitamos sumar orders por turno. Lo hacemos
      // consultando por (opened_by, ventana de tiempo) para cada turno;
      // batch en una sola query con IN sobre opened_by + filtros.
      // Como las ventanas son distintas por turno, agrupamos client-side.
      const userIds = Array.from(new Set(shiftsRaw.map((s) => s.opened_by)))
      const earliest = shiftsRaw.reduce(
        (min, s) => (s.opened_at < min ? s.opened_at : min),
        shiftsRaw[0].opened_at,
      )
      const latest = shiftsRaw.reduce(
        (max, s) =>
          (s.closed_at ?? s.opened_at) > max
            ? (s.closed_at ?? s.opened_at)
            : max,
        shiftsRaw[0].closed_at ?? shiftsRaw[0].opened_at,
      )

      const { data: ordersRaw, error: ordersErr } = await supabase
        .from('orders')
        .select('id, total, created_at, created_by')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .eq('status' as never, 'completed')
        .in('created_by' as never, userIds)
        .gte('created_at' as never, earliest)
        .lte('created_at' as never, latest)

      if (ordersErr) throw ordersErr

      // Excluir órdenes generadas al completar separados: cada abono ya
      // contó como ingreso del turno donde se cobró.
      const { data: convRaw, error: convErr } = await supabase
        .from('layaways')
        .select('converted_order_id')
        .eq('store_id' as never, storeId)
        .not('converted_order_id' as never, 'is', null)
        .gte('completed_at' as never, earliest)
        .lte('completed_at' as never, latest)
      if (convErr) throw convErr
      const excludedOrderIds = new Set(
        ((convRaw ?? []) as unknown as { converted_order_id: string | null }[])
          .map((r) => r.converted_order_id)
          .filter((id): id is string => !!id),
      )

      const cashByShift = new Map<string, number>()
      for (const o of (ordersRaw ?? []) as unknown as {
        id: string
        total: number | string
        created_at: string
        created_by: string
      }[]) {
        if (excludedOrderIds.has(o.id)) continue
        for (const s of shiftsRaw) {
          if (s.opened_by !== o.created_by) continue
          if (o.created_at < s.opened_at) continue
          if (s.closed_at && o.created_at > s.closed_at) continue
          cashByShift.set(s.id, (cashByShift.get(s.id) ?? 0) + Number(o.total))
          break
        }
      }

      // Sumar abonos de separados en efectivo al cashByShift.
      const { data: paymentsRaw, error: paymentsErr } = await supabase
        .from('layaway_payments')
        .select('amount, payment_method, created_at, created_by')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .in('created_by' as never, userIds)
        .gte('created_at' as never, earliest)
        .lte('created_at' as never, latest)
      if (paymentsErr) throw paymentsErr

      for (const p of (paymentsRaw ?? []) as unknown as {
        amount: number | string
        created_at: string
        created_by: string
      }[]) {
        for (const s of shiftsRaw) {
          if (s.opened_by !== p.created_by) continue
          if (p.created_at < s.opened_at) continue
          if (s.closed_at && p.created_at > s.closed_at) continue
          cashByShift.set(s.id, (cashByShift.get(s.id) ?? 0) + Number(p.amount))
          break
        }
      }

      const rows: ShiftHistoryRow[] = shiftsRaw.map((s) => {
        const openingAmount = Number(s.opening_amount)
        const cashSales = cashByShift.get(s.id) ?? 0
        const totalExpenses = expByShift.get(s.id) ?? 0
        const rec = reconcileCash(openingAmount + cashSales, totalExpenses)
        const countedCash =
          s.closing_amount != null ? Number(s.closing_amount) : 0
        return {
          shift: {
            id: s.id,
            store_id: s.store_id,
            opened_by: s.opened_by,
            closed_by: s.closed_by,
            opening_amount: openingAmount,
            closing_amount: countedCash,
            opened_at: s.opened_at,
            closed_at: s.closed_at,
            updated_at: s.updated_at,
          },
          cashierName: s.profiles?.full_name ?? 'Cajero',
          cashSales,
          totalExpenses,
          expectedCash: rec.expectedCash,
          overdraft: rec.overdraft,
          countedCash,
          difference: shiftDifference(countedCash, rec),
        }
      })

      return {
        rows,
        totalCount: count ?? rows.length,
        page: filters.page,
        pageSize: SHIFT_HISTORY_PAGE_SIZE,
      }
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── Lista de cajeros de la tienda para el filtro ──────────────────────────────

export function useStoreCashiers() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<Profile[]>({
    queryKey: ['store-cashiers', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id' as never, storeId)
        .order('full_name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Profile[]
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}
