import { useQuery } from '@tanstack/react-query'
import { format, subDays, startOfMonth } from 'date-fns'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type {
  DailySalesSummary,
  ProductPerformance,
  InventoryStatus,
  ReturnsSummary,
  PaymentMethod,
  LayawaySummary,
  LayawayExpiringSoon,
  LayawayStatus,
  PurchaseSummary,
  SupplierBalance,
  InvoiceStatus,
} from '@/types/database.types'

const STALE_5_MIN = 5 * 60 * 1_000

// ── useReports ────────────────────────────────────────────────────────────────

export type ReportsFilters = {
  from: Date
  to: Date
}

export function useReports({ from, to }: ReportsFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

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
  const storeId    = getActiveStoreId(profile)
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

// ── useLayawaysSummary ────────────────────────────────────────────────────────

export type LayawayKpis = {
  activeCount: number
  activeAmount: number          // total - paid de activos (comprometido pendiente)
  completedCount: number
  cancelledCount: number
  expiredCount: number
  totalPaid: number             // recaudado en activos
  conversionRate: number        // completed / (completed + cancelled + expired)
  byStatus: Record<LayawayStatus, LayawaySummary | null>
}

export function useLayawaysSummary() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['reports', 'layaways-summary', storeId],
    queryFn: async (): Promise<LayawayKpis> => {
      const { data, error } = await supabase
        .from('layaway_summary' as never)
        .select('*')

      if (error) {
        toast.error('Error cargando resumen de separados')
        throw error
      }

      const rows = (data ?? []) as unknown as LayawaySummary[]
      const byStatus: Record<LayawayStatus, LayawaySummary | null> = {
        active: null,
        completed: null,
        cancelled: null,
        expired: null,
      }
      for (const r of rows) byStatus[r.status] = r

      const active    = byStatus.active
      const completed = byStatus.completed
      const cancelled = byStatus.cancelled
      const expired   = byStatus.expired

      const closed = (completed?.layaway_count ?? 0)
                   + (cancelled?.layaway_count ?? 0)
                   + (expired?.layaway_count   ?? 0)
      const conversionRate = closed > 0
        ? ((completed?.layaway_count ?? 0) / closed) * 100
        : 0

      return {
        activeCount:    active?.layaway_count    ?? 0,
        activeAmount:   Number(active?.pending_amount ?? 0),
        completedCount: completed?.layaway_count ?? 0,
        cancelledCount: cancelled?.layaway_count ?? 0,
        expiredCount:   expired?.layaway_count   ?? 0,
        totalPaid:      Number(active?.paid_amount ?? 0),
        conversionRate,
        byStatus,
      }
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

// ── useExpiringLayaways ───────────────────────────────────────────────────────

export function useExpiringLayaways() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['reports', 'layaways-expiring', storeId],
    queryFn: async (): Promise<LayawayExpiringSoon[]> => {
      const { data, error } = await supabase
        .from('layaway_expiring_soon' as never)
        .select('*')
        .order('expires_at' as never, { ascending: true })

      if (error) {
        toast.error('Error cargando separados próximos a vencer')
        throw error
      }
      return (data ?? []) as unknown as LayawayExpiringSoon[]
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

// ── useLayawaysForExport ──────────────────────────────────────────────────────
// Lista plana para la hoja 6 del Excel: una fila por separado.

export type LayawayExportRow = {
  id: string
  layaway_number: number
  created_at: string
  customer_name: string
  customer_phone: string | null
  items_count: number
  total: number
  paid_amount: number
  pending: number
  status: LayawayStatus
  expires_at: string
  completed_at: string | null
  cancelled_at: string | null
}

interface RawExportLayaway {
  id: string
  layaway_number: number
  created_at: string
  total: number
  paid_amount: number
  status: LayawayStatus
  expires_at: string
  completed_at: string | null
  cancelled_at: string | null
  customers: { full_name: string; phone: string | null } | null
  layaway_items: { id: string }[]
}

export function useLayawaysForExport() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['reports', 'layaways-export', storeId],
    queryFn: async (): Promise<LayawayExportRow[]> => {
      const { data, error } = await supabase
        .from('layaways')
        .select(`
          id, layaway_number, created_at, total, paid_amount, status,
          expires_at, completed_at, cancelled_at,
          customers(full_name, phone),
          layaway_items(id)
        `)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
        .limit(5000)

      if (error) {
        toast.error('Error preparando export de separados')
        throw error
      }
      return (data ?? []).map((row) => {
        const r = row as unknown as RawExportLayaway
        return {
          id: r.id,
          layaway_number: r.layaway_number,
          created_at: r.created_at,
          customer_name: r.customers?.full_name ?? '',
          customer_phone: r.customers?.phone ?? null,
          items_count: (r.layaway_items ?? []).length,
          total: Number(r.total) || 0,
          paid_amount: Number(r.paid_amount) || 0,
          pending: Math.max(0, Number(r.total) - Number(r.paid_amount)),
          status: r.status,
          expires_at: r.expires_at,
          completed_at: r.completed_at,
          cancelled_at: r.cancelled_at,
        }
      })
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

export function useInventoryReport() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

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

// ── usePurchaseReport ───────────────────────────────────────────────────────
// Compras del período desde purchase_summary, agrupadas por mes y proveedor.
// avgDaysToPay se calcula con los abonos del período (payment_date - invoice_date).

export type PurchaseMonthRow = {
  month: string            // 'YYYY-MM-DD'
  total_purchased: number
  total_paid: number
  total_pending: number
  invoice_count: number
}

export type PurchaseSupplierRow = {
  supplier_id: string
  supplier_name: string
  total_purchased: number
  total_paid: number
  total_pending: number
  invoice_count: number
}

export type PurchaseReport = {
  byMonth: PurchaseMonthRow[]
  bySupplier: PurchaseSupplierRow[]
  totalPurchased: number
  totalPaid: number
  totalPending: number
  avgDaysToPay: number | null
}

interface RawPaymentForAvg {
  payment_date: string
  purchase_invoices: { invoice_date: string } | null
}

export function usePurchaseReport({ from, to }: ReportsFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  const fromMonth = format(startOfMonth(from), 'yyyy-MM-dd')
  const fromDate  = format(from, 'yyyy-MM-dd')
  const toDate    = format(to,   'yyyy-MM-dd')

  return useQuery({
    queryKey: ['reports', 'purchases', storeId, fromMonth, toDate],
    queryFn: async (): Promise<PurchaseReport> => {
      const { data, error } = await supabase
        .from('purchase_summary' as never)
        .select('*')
        .gte('month' as never, fromMonth)
        .lte('month' as never, toDate)
        .order('month' as never, { ascending: true })

      if (error) {
        toast.error('Error cargando reporte de compras')
        throw error
      }

      const rows = (data ?? []) as unknown as PurchaseSummary[]

      const monthMap = new Map<string, PurchaseMonthRow>()
      const supplierMap = new Map<string, PurchaseSupplierRow>()
      let totalPurchased = 0
      let totalPaid = 0
      let totalPending = 0

      for (const r of rows) {
        const purchased = Number(r.total_purchased)
        const paid = Number(r.total_paid)
        const pending = Number(r.total_pending)
        totalPurchased += purchased
        totalPaid += paid
        totalPending += pending

        const m = monthMap.get(r.month) ?? {
          month: r.month,
          total_purchased: 0,
          total_paid: 0,
          total_pending: 0,
          invoice_count: 0,
        }
        m.total_purchased += purchased
        m.total_paid += paid
        m.total_pending += pending
        m.invoice_count += r.invoice_count
        monthMap.set(r.month, m)

        const s = supplierMap.get(r.supplier_id) ?? {
          supplier_id: r.supplier_id,
          supplier_name: r.supplier_name,
          total_purchased: 0,
          total_paid: 0,
          total_pending: 0,
          invoice_count: 0,
        }
        s.total_purchased += purchased
        s.total_paid += paid
        s.total_pending += pending
        s.invoice_count += r.invoice_count
        supplierMap.set(r.supplier_id, s)
      }

      // Promedio de días de pago: abonos del período vs fecha de su factura
      const { data: payData, error: payErr } = await supabase
        .from('supplier_payments')
        .select('payment_date, purchase_invoices(invoice_date)')
        .eq('store_id' as never, storeId)
        .gte('payment_date' as never, fromDate)
        .lte('payment_date' as never, toDate)
      if (payErr) throw payErr

      const payRows = (payData ?? []) as unknown as RawPaymentForAvg[]
      let daySum = 0
      let dayCount = 0
      for (const p of payRows) {
        const inv = p.purchase_invoices?.invoice_date
        if (!inv) continue
        const diff = Math.round(
          (new Date(p.payment_date).getTime() - new Date(inv).getTime()) /
            86_400_000,
        )
        if (diff >= 0) {
          daySum += diff
          dayCount += 1
        }
      }
      const avgDaysToPay = dayCount > 0 ? daySum / dayCount : null

      return {
        byMonth: [...monthMap.values()].sort((a, b) =>
          a.month.localeCompare(b.month),
        ),
        bySupplier: [...supplierMap.values()].sort(
          (a, b) => b.total_purchased - a.total_purchased,
        ),
        totalPurchased,
        totalPaid,
        totalPending,
        avgDaysToPay,
      }
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

// ── useSupplierBalances ───────────────────────────────────────────────────────
// Saldos consolidados por proveedor (activos e inactivos) desde supplier_balance.

export type SupplierBalancesData = {
  balances: SupplierBalance[]
  totalPending: number
  suppliersWithDebt: number
  overdueInvoices: number
  openInvoices: number
}

export function useSupplierBalances() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['reports', 'supplier-balances', storeId],
    queryFn: async (): Promise<SupplierBalancesData> => {
      const { data, error } = await supabase
        .from('supplier_balance' as never)
        .select('*')
        .order('pending_amount' as never, { ascending: false })

      if (error) {
        toast.error('Error cargando saldos de proveedores')
        throw error
      }

      const rows = (data ?? []) as unknown as SupplierBalance[]
      const balances = rows.map((r) => ({
        ...r,
        total_purchased: Number(r.total_purchased),
        pending_amount: Number(r.pending_amount),
      }))

      const totalPending = balances.reduce((s, r) => s + r.pending_amount, 0)
      const suppliersWithDebt = balances.filter((r) => r.pending_amount > 0).length
      const overdueInvoices = balances.reduce((s, r) => s + r.overdue_invoices, 0)
      const openInvoices = balances.reduce((s, r) => s + r.open_invoices, 0)

      return { balances, totalPending, suppliersWithDebt, overdueInvoices, openInvoices }
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}

// ── useInvoicesForExport ──────────────────────────────────────────────────────
// Lista plana de facturas del período para la hoja "Compras" del Excel.

export type InvoiceExportRow = {
  invoice_number: string
  invoice_date: string
  supplier_name: string
  subtotal: number
  tax: number
  total: number
  paid_amount: number
  pending: number
  status: InvoiceStatus
  due_date: string | null
}

interface RawExportInvoice {
  invoice_number: string
  invoice_date: string
  subtotal: number
  tax: number
  total: number
  paid_amount: number
  status: InvoiceStatus
  due_date: string | null
  suppliers: { name: string } | null
}

export function useInvoicesForExport({ from, to }: ReportsFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  const fromDate = format(from, 'yyyy-MM-dd')
  const toDate   = format(to,   'yyyy-MM-dd')

  return useQuery({
    queryKey: ['reports', 'invoices-export', storeId, fromDate, toDate],
    queryFn: async (): Promise<InvoiceExportRow[]> => {
      const { data, error } = await supabase
        .from('purchase_invoices')
        .select(
          'invoice_number, invoice_date, subtotal, tax, total, paid_amount, status, due_date, suppliers(name)',
        )
        .eq('store_id' as never, storeId)
        .gte('invoice_date' as never, fromDate)
        .lte('invoice_date' as never, toDate)
        .order('invoice_date' as never, { ascending: false })
        .limit(5000)

      if (error) {
        toast.error('Error preparando export de compras')
        throw error
      }

      return (data ?? []).map((row) => {
        const r = row as unknown as RawExportInvoice
        const total = Number(r.total)
        const paid = Number(r.paid_amount)
        return {
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          supplier_name: r.suppliers?.name ?? '',
          subtotal: Number(r.subtotal),
          tax: Number(r.tax),
          total,
          paid_amount: paid,
          pending: Math.max(0, total - paid),
          status: r.status,
          due_date: r.due_date,
        }
      })
    },
    enabled: !!storeId,
    staleTime: STALE_5_MIN,
  })
}
