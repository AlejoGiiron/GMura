import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type {
  DailySalesSummary,
  ProductPerformance,
  InventoryStatus,
  ReturnsSummary,
  PaymentMethod,
} from '@/types/database.types'

const STALE_5_MIN = 5 * 60 * 1_000

// ── useReports ────────────────────────────────────────────────────────────────

export type ReportsFilters = {
  from: Date
  to: Date
}

export function useReports({ from, to }: ReportsFilters) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  const fromDate = format(from, 'yyyy-MM-dd')
  const toDate   = format(to,   'yyyy-MM-dd')

  const dailySalesQuery = useQuery({
    queryKey: ['reports', 'daily-sales', storeId, fromDate, toDate],
    queryFn: async (): Promise<DailySalesSummary[]> => {
      const { data, error } = await supabase
        .from('daily_sales_summary' as never)
        .select('*')
        .gte('sale_date' as never, fromDate)
        .lte('sale_date' as never, toDate)
        .order('sale_date' as never, { ascending: true })

      if (error) {
        toast.error('Error cargando ventas diarias')
        throw error
      }
      return (data ?? []) as unknown as DailySalesSummary[]
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })

  const productPerformanceQuery = useQuery({
    queryKey: ['reports', 'product-performance', storeId],
    queryFn: async (): Promise<ProductPerformance[]> => {
      const { data, error } = await supabase
        .from('product_performance' as never)
        .select('*')
        .order('revenue' as never, { ascending: false })

      if (error) {
        toast.error('Error cargando desempeño de productos')
        throw error
      }
      return (data ?? []) as unknown as ProductPerformance[]
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })

  const returnsSummaryQuery = useQuery({
    queryKey: ['reports', 'returns-summary', storeId, fromDate, toDate],
    queryFn: async (): Promise<ReturnsSummary[]> => {
      const { data, error } = await supabase
        .from('returns_summary' as never)
        .select('*')
        .gte('return_date' as never, fromDate)
        .lte('return_date' as never, toDate)
        .order('return_date' as never, { ascending: true })

      if (error) {
        toast.error('Error cargando resumen de devoluciones')
        throw error
      }
      return (data ?? []) as unknown as ReturnsSummary[]
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })

  return {
    dailySales:         dailySalesQuery.data         ?? [],
    productPerformance: productPerformanceQuery.data ?? [],
    returnsSummary:     returnsSummaryQuery.data     ?? [],
    isLoading:
      dailySalesQuery.isLoading ||
      productPerformanceQuery.isLoading ||
      returnsSummaryQuery.isLoading,
    error:
      dailySalesQuery.error ??
      productPerformanceQuery.error ??
      returnsSummaryQuery.error,
  }
}

// ── useDailySummary ───────────────────────────────────────────────────────────

export type DayComparison = {
  totalSales: number
  totalOrders: number
  avgTicket: number
  byPaymentMethod: Partial<Record<PaymentMethod, { orders: number; total: number }>>
  changePercent: number | null  // null si no hay datos del día anterior
}

export function useDailySummary(date: Date) {
  const { profile } = useAuth()
  const storeId    = profile?.store_id ?? ''
  const dateStr    = format(date,             'yyyy-MM-dd')
  const prevStr    = format(subDays(date, 1), 'yyyy-MM-dd')

  return useQuery({
    queryKey: ['reports', 'daily-summary', storeId, dateStr],
    queryFn: async (): Promise<DayComparison> => {
      const { data, error } = await supabase
        .from('daily_sales_summary' as never)
        .select('*')
        .gte('sale_date' as never, prevStr)
        .lte('sale_date' as never, dateStr)

      if (error) {
        toast.error('Error cargando resumen del día')
        throw error
      }

      const rows      = (data ?? []) as unknown as DailySalesSummary[]
      const today     = rows.filter((r) => r.sale_date === dateStr)
      const yesterday = rows.filter((r) => r.sale_date === prevStr)

      const totalSales  = today.reduce((sum, r) => sum + Number(r.total_sum), 0)
      const totalOrders = today.reduce((sum, r) => sum + r.order_count, 0)
      const avgTicket   = totalOrders > 0 ? totalSales / totalOrders : 0

      const byPaymentMethod: Partial<Record<PaymentMethod, { orders: number; total: number }>> = {}
      for (const r of today) {
        const prev = byPaymentMethod[r.payment_method]
        byPaymentMethod[r.payment_method] = {
          orders: (prev?.orders ?? 0) + r.order_count,
          total:  (prev?.total  ?? 0) + Number(r.total_sum),
        }
      }

      const prevTotal    = yesterday.reduce((sum, r) => sum + Number(r.total_sum), 0)
      const changePercent =
        prevTotal > 0 ? ((totalSales - prevTotal) / prevTotal) * 100 : null

      return { totalSales, totalOrders, avgTicket, byPaymentMethod, changePercent }
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

// ── useInventoryReport ────────────────────────────────────────────────────────

export type InventoryReport = {
  totalValue:      number
  outOfStockCount: number
  lowStockCount:   number
  items:           InventoryStatus[]
}

export function useInventoryReport() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['reports', 'inventory', storeId],
    queryFn: async (): Promise<InventoryReport> => {
      const { data, error } = await supabase
        .from('inventory_status' as never)
        .select('*')
        .order('product_name' as never, { ascending: true })
        .order('size'         as never, { ascending: true })

      if (error) {
        toast.error('Error cargando reporte de inventario')
        throw error
      }

      const items          = (data ?? []) as unknown as InventoryStatus[]
      const totalValue     = items.reduce((sum, i) => sum + Number(i.stock_value), 0)
      const outOfStockCount = items.filter((i) => i.stock_state === 'out').length
      const lowStockCount   = items.filter((i) => i.stock_state === 'low').length

      return { totalValue, outOfStockCount, lowStockCount, items }
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}
