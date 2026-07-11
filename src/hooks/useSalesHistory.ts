import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { bogotaDayStartToUtc, bogotaDayEndToUtc } from '@/lib/dates'
import { useDebounce } from './useDebounce'
import type {
  OrderStatus,
  PaymentMethod,
  ReturnType,
} from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SalesHistoryFilters = {
  query: string
  dateFrom: string
  dateTo: string
  paymentMethod: PaymentMethod | 'all'
  status: OrderStatus | 'all'
  page: number
}

export const PAGE_SIZE = 50

export type SalesHistoryRow = {
  id: string
  order_number: number
  created_at: string
  total: number
  subtotal: number
  discount: number
  payment_method: PaymentMethod
  status: OrderStatus
  cash_received: number | null
  // Fiado (029): para mostrar "Pagado" / "Debe $X" derivado de paid_amount.
  is_credit: boolean
  paid_amount: number
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  items_count: number
}

export type SalesHistoryResult = {
  rows: SalesHistoryRow[]
  totalCount: number
  page: number
  pageSize: number
}

export type SalesHistorySummary = {
  totalRevenue: number
  orderCount: number
  averageTicket: number
  returnsCount: number
}

export type SaleDetailItem = {
  id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
  list_price: number
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
}

export type SaleDetailReturn = {
  id: string
  created_at: string
  type: ReturnType
  notes: string | null
  items_count: number
  refund_total: number
}

export type SaleDetail = {
  id: string
  order_number: number
  created_at: string
  status: OrderStatus
  subtotal: number
  discount: number
  surcharge: number
  total: number
  payment_method: PaymentMethod
  cash_received: number | null
  // Desglose de pagos (order_payments, 032). Vacío para fiados/ventas sin filas.
  payments: { method: PaymentMethod; amount: number }[]
  customer: { id: string; full_name: string; phone: string | null } | null
  items: SaleDetailItem[]
  returns: SaleDetailReturn[]
}

// ── Raw Supabase shapes ───────────────────────────────────────────────────────

type RawOrderRow = {
  id: string
  order_number: number
  created_at: string
  total: number
  subtotal: number
  discount: number
  payment_method: string
  status: string
  cash_received: number | null
  is_credit: boolean
  paid_amount: number
  customer_id: string | null
  customers: { full_name: string; phone: string | null } | null
  order_items: { id: string }[]
}

type RawOrderDetail = {
  id: string
  order_number: number
  created_at: string
  status: string
  subtotal: number
  discount: number
  surcharge: number
  total: number
  payment_method: string
  cash_received: number | null
  customers: { id: string; full_name: string; phone: string | null } | null
  order_items: {
    id: string
    variant_id: string
    product_id: string
    qty: number
    unit_price: number
    list_price: number
    variants: {
      size: string | null
      color: string | null
      products: { name: string; brand: string | null } | null
    } | null
  }[]
  order_payments: { method: string; amount: number }[]
}

type RawReturnRow = {
  id: string
  created_at: string
  type: string
  notes: string | null
  return_items: { qty: number; unit_price: number }[]
}

// ── useSalesHistory ───────────────────────────────────────────────────────────

export function useSalesHistory(filters: SalesHistoryFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const dq = useDebounce(filters.query.trim(), 300)

  return useQuery({
    queryKey: ['sales-history', 'list', storeId, { ...filters, query: dq }],
    queryFn: async (): Promise<SalesHistoryResult> => {
      const from = filters.page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let customerIds: string[] | null = null
      if (dq.length >= 2) {
        const { data: matches, error: cErr } = await supabase
          .from('customers')
          .select('id')
          .eq('store_id' as never, storeId)
          .or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%` as never)
          .limit(50)
        if (cErr) throw cErr
        customerIds = (matches ?? []).map((m) => (m as { id: string }).id)
      }

      let q = supabase
        .from('orders')
        .select(
          `id, order_number, created_at, total, subtotal, discount,
           payment_method, status, cash_received, is_credit, paid_amount, customer_id,
           customers(full_name, phone),
           order_items(id)`,
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
        .range(from, to)

      if (filters.paymentMethod !== 'all') {
        q = q.eq('payment_method' as never, filters.paymentMethod)
      }
      if (filters.status !== 'all') {
        q = q.eq('status' as never, filters.status)
      }
      if (filters.dateFrom) {
        q = q.gte('created_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        q = q.lte('created_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      if (dq.length >= 1) {
        const orParts: string[] = []
        const numericQuery = dq.replace(/^#/, '')
        if (/^\d+$/.test(numericQuery)) {
          orParts.push(`order_number.eq.${numericQuery}`)
        } else if (dq.length >= 2) {
          orParts.push(`id.ilike.%${dq}%`)
        }
        if (customerIds && customerIds.length > 0) {
          orParts.push(`customer_id.in.(${customerIds.join(',')})`)
        }
        if (orParts.length > 0) {
          q = q.or(orParts.join(',') as never)
        }
      }

      const { data, error, count } = await q
      if (error) throw error

      const rows: SalesHistoryRow[] = (data ?? []).map((row) => {
        const r = row as unknown as RawOrderRow
        return {
          id: r.id,
          order_number: r.order_number,
          created_at: r.created_at,
          total: r.total,
          subtotal: r.subtotal,
          discount: r.discount,
          payment_method: r.payment_method as PaymentMethod,
          status: r.status as OrderStatus,
          cash_received: r.cash_received,
          is_credit: r.is_credit ?? false,
          paid_amount: Number(r.paid_amount) || 0,
          customer_id: r.customer_id,
          customer_name: r.customers?.full_name ?? null,
          customer_phone: r.customers?.phone ?? null,
          items_count: r.order_items.length,
        }
      })

      return {
        rows,
        totalCount: count ?? rows.length,
        page: filters.page,
        pageSize: PAGE_SIZE,
      }
    },
    enabled: !!storeId,
    staleTime: 15_000,
  })
}

// ── useSalesSummary ───────────────────────────────────────────────────────────

export function useSalesSummary(filters: SalesHistoryFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: [
      'sales-history',
      'summary',
      storeId,
      filters.dateFrom,
      filters.dateTo,
      filters.paymentMethod,
      filters.status,
    ],
    queryFn: async (): Promise<SalesHistorySummary> => {
      let oq = supabase
        .from('orders')
        .select('total, status')
        .eq('store_id' as never, storeId)

      if (filters.paymentMethod !== 'all') {
        oq = oq.eq('payment_method' as never, filters.paymentMethod)
      }
      if (filters.status !== 'all') {
        oq = oq.eq('status' as never, filters.status)
      }
      if (filters.dateFrom) {
        oq = oq.gte('created_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        oq = oq.lte('created_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { data: orders, error } = await oq
      if (error) throw error

      const rows = (orders ?? []) as unknown as { total: number; status: string }[]
      const orderCount = rows.length
      const totalRevenue = rows.reduce((s, r) => s + r.total, 0)
      const averageTicket = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0

      let rq = supabase
        .from('returns')
        .select('id', { count: 'exact', head: true })
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'completed')

      if (filters.dateFrom) {
        rq = rq.gte('created_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        rq = rq.lte('created_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { count: returnsCount, error: rErr } = await rq
      if (rErr) throw rErr

      return {
        totalRevenue,
        orderCount,
        averageTicket,
        returnsCount: returnsCount ?? 0,
      }
    },
    enabled: !!storeId,
    staleTime: 15_000,
  })
}

// ── useSaleDetail ─────────────────────────────────────────────────────────────

export function useSaleDetail(orderId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['sales-history', 'detail', orderId, storeId],
    queryFn: async (): Promise<SaleDetail | null> => {
      if (!orderId) return null

      const { data: raw, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, created_at, status, subtotal, discount, surcharge, total,
          payment_method, cash_received,
          customers(id, full_name, phone),
          order_payments(method, amount),
          order_items(
            id, variant_id, product_id, qty, unit_price, list_price,
            variants(size, color, products(name, brand))
          )
        `)
        .eq('id' as never, orderId)
        .eq('store_id' as never, storeId)
        .single()

      if (error) throw error
      const order = raw as unknown as RawOrderDetail

      const { data: returnsRaw, error: retErr } = await supabase
        .from('returns')
        .select('id, created_at, type, notes, return_items(qty, unit_price)')
        .eq('original_order_id' as never, orderId)
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'completed')
        .order('created_at' as never, { ascending: false })

      if (retErr) throw retErr

      const returns: SaleDetailReturn[] = (
        (returnsRaw ?? []) as unknown as RawReturnRow[]
      ).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        type: r.type as ReturnType,
        notes: r.notes,
        items_count: r.return_items.length,
        refund_total: r.return_items.reduce(
          (s, ri) => s + ri.qty * ri.unit_price,
          0,
        ),
      }))

      return {
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        status: order.status as OrderStatus,
        subtotal: order.subtotal,
        discount: order.discount,
        surcharge: order.surcharge,
        total: order.total,
        payment_method: order.payment_method as PaymentMethod,
        cash_received: order.cash_received,
        payments: (order.order_payments ?? []).map((p) => ({
          method: p.method as PaymentMethod,
          amount: Number(p.amount),
        })),
        customer: order.customers
          ? {
              id: order.customers.id,
              full_name: order.customers.full_name,
              phone: order.customers.phone,
            }
          : null,
        items: order.order_items.map((oi) => ({
          id: oi.id,
          variant_id: oi.variant_id,
          product_id: oi.product_id,
          qty: oi.qty,
          unit_price: oi.unit_price,
          list_price: oi.list_price,
          product_name: oi.variants?.products?.name ?? 'Producto eliminado',
          brand: oi.variants?.products?.brand ?? null,
          size: oi.variants?.size ?? null,
          color: oi.variants?.color ?? null,
        })),
        returns,
      }
    },
    enabled: !!orderId && !!storeId,
    staleTime: 30_000,
  })
}
