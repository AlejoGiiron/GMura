import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useDebounce } from './useDebounce'
import toast from 'react-hot-toast'
import type { PaymentMethod, ReturnType, ReturnStatus } from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FoundOrderItem = {
  id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
  qty_returned: number
  product_name: string
  size: string | null
  color: string | null
}

export type FoundOrder = {
  id: string
  order_number: number
  created_at: string
  total: number
  payment_method: PaymentMethod
  customer_id: string | null
  customer: { full_name: string; phone: string | null } | null
  items: FoundOrderItem[]
}

export type OrderSearchResult = {
  id: string
  order_number: number
  created_at: string
  total: number
  payment_method: PaymentMethod
  customer_id: string | null
  customer: { full_name: string; phone: string | null } | null
  items_count: number
}

export type ReturnHistoryFilters = {
  type: ReturnType | 'all'
  dateFrom: string
  dateTo: string
}

export type ReturnHistoryRow = {
  id: string
  created_at: string
  type: ReturnType
  status: ReturnStatus
  notes: string | null
  original_order_id: string
  original_order_number: number | null
  customer_name: string | null
  items_count: number
  refund_total: number
}

export type ExchangeVariantOption = {
  id: string
  product_id: string
  product_name: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  sku: string | null
}

// ── Raw shapes from Supabase ──────────────────────────────────────────────────

type RawOrderSearch = {
  id: string
  order_number: number
  created_at: string
  total: number
  payment_method: string
  customer_id: string | null
  customers: { full_name: string; phone: string | null } | null
  order_items: { id: string }[]
}

type RawOrderDetail = {
  id: string
  order_number: number
  created_at: string
  total: number
  payment_method: string
  customer_id: string | null
  customers: { full_name: string; phone: string | null } | null
  order_items: {
    id: string
    variant_id: string
    product_id: string
    qty: number
    unit_price: number
    variants: {
      size: string | null
      color: string | null
      products: { name: string }
    } | null
  }[]
}

type RawReturnForQty = {
  id: string
  status: string
  return_items: { variant_id: string; qty: number }[]
}

type RawReturnHistory = {
  id: string
  created_at: string
  type: string
  status: string
  notes: string | null
  original_order_id: string
  orders: { order_number: number } | null
  return_items: { qty: number; unit_price: number }[]
}

// ── useOrderSearch ─────────────────────────────────────────────────────────────

const SEARCH_SELECT =
  'id, order_number, created_at, total, payment_method, customer_id, customers(full_name, phone), order_items(id)'

function toSearchResult(row: RawOrderSearch): OrderSearchResult {
  return {
    id: row.id,
    order_number: row.order_number,
    created_at: row.created_at,
    total: row.total,
    payment_method: row.payment_method as PaymentMethod,
    customer_id: row.customer_id,
    customer: row.customers,
    items_count: row.order_items.length,
  }
}

export function useOrderSearch(query: string) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['returns', 'order-search', storeId, dq],
    queryFn: async (): Promise<OrderSearchResult[]> => {
      if (dq.length < 1) return []

      const results = new Map<string, OrderSearchResult>()
      const numericMatch = dq.match(/^#?(\d+)$/)

      if (numericMatch) {
        const orderNumber = parseInt(numericMatch[1], 10)
        if (Number.isFinite(orderNumber) && orderNumber > 0) {
          const byNumber = await supabase
            .from('orders')
            .select(SEARCH_SELECT)
            .eq('store_id' as never, storeId)
            .eq('order_number' as never, orderNumber)
            .limit(5)

          if (byNumber.error) throw byNumber.error
          for (const row of (byNumber.data ?? []) as unknown as RawOrderSearch[]) {
            results.set(row.id, toSearchResult(row))
          }
        }
      } else if (dq.length >= 2) {
        const byCustomer = await supabase
          .from('customers')
          .select('id')
          .eq('store_id' as never, storeId)
          .or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%` as never)
          .limit(20)

        if (byCustomer.error) {
          toast.error(byCustomer.error.message)
        } else if ((byCustomer.data ?? []).length > 0) {
          const ids = (byCustomer.data ?? []).map(
            (c) => (c as { id: string }).id,
          )
          const byOrders = await supabase
            .from('orders')
            .select(SEARCH_SELECT)
            .eq('store_id' as never, storeId)
            .in('customer_id' as never, ids)
            .order('created_at' as never, { ascending: false })
            .limit(10)

          if (byOrders.error) {
            toast.error(byOrders.error.message)
          } else {
            for (const row of (byOrders.data ?? []) as unknown as RawOrderSearch[]) {
              if (!results.has(row.id)) {
                results.set(row.id, toSearchResult(row))
              }
            }
          }
        }
      }

      return Array.from(results.values()).slice(0, 10)
    },
    enabled: !!storeId && dq.length >= 1,
    staleTime: 15_000,
  })
}

// ── useOrderDetail ─────────────────────────────────────────────────────────────

export function useOrderDetail(orderId: string | null) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['returns', 'order-detail', orderId],
    queryFn: async (): Promise<FoundOrder | null> => {
      if (!orderId) return null

      const { data: raw, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, created_at, total, payment_method, customer_id,
          customers(full_name, phone),
          order_items(
            id, variant_id, product_id, qty, unit_price,
            variants(size, color, products(name))
          )
        `)
        .eq('id' as never, orderId)
        .eq('store_id' as never, storeId)
        .single()

      if (error) throw error

      const order = raw as unknown as RawOrderDetail

      const { data: returns, error: retErr } = await supabase
        .from('returns')
        .select('id, status, return_items(variant_id, qty)')
        .eq('original_order_id' as never, orderId)
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'completed')

      if (retErr) throw retErr

      const qtyReturnedByVariant: Record<string, number> = {}
      for (const ret of (returns ?? []) as unknown as RawReturnForQty[]) {
        for (const ri of ret.return_items) {
          qtyReturnedByVariant[ri.variant_id] =
            (qtyReturnedByVariant[ri.variant_id] ?? 0) + ri.qty
        }
      }

      return {
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        total: order.total,
        payment_method: order.payment_method as PaymentMethod,
        customer_id: order.customer_id,
        customer: order.customers,
        items: order.order_items.map((oi) => ({
          id: oi.id,
          variant_id: oi.variant_id,
          product_id: oi.product_id,
          qty: oi.qty,
          unit_price: oi.unit_price,
          qty_returned: qtyReturnedByVariant[oi.variant_id] ?? 0,
          product_name: oi.variants?.products?.name ?? 'Producto eliminado',
          size: oi.variants?.size ?? null,
          color: oi.variants?.color ?? null,
        })),
      }
    },
    enabled: !!orderId && !!storeId,
    staleTime: 30_000,
  })
}

// ── useReturnHistory ──────────────────────────────────────────────────────────

export function useReturnHistory(filters: ReturnHistoryFilters) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['returns', 'history', storeId, filters],
    queryFn: async (): Promise<ReturnHistoryRow[]> => {
      let q = supabase
        .from('returns')
        .select(
          `id, created_at, type, status, notes, original_order_id,
           orders:original_order_id(order_number),
           return_items(qty, unit_price)`,
        )
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
        .limit(60)

      if (filters.type !== 'all') {
        q = q.eq('type' as never, filters.type)
      }
      if (filters.dateFrom) {
        q = q.gte('created_at' as never, `${filters.dateFrom}T00:00:00`)
      }
      if (filters.dateTo) {
        q = q.lte('created_at' as never, `${filters.dateTo}T23:59:59`)
      }

      const { data, error } = await q
      if (error) throw error

      return (data ?? []).map((row) => {
        const r = row as unknown as RawReturnHistory
        const refund_total = r.return_items.reduce(
          (sum, ri) => sum + ri.qty * ri.unit_price,
          0,
        )
        return {
          id: r.id,
          created_at: r.created_at,
          type: r.type as ReturnType,
          status: r.status as ReturnStatus,
          notes: r.notes,
          original_order_id: r.original_order_id,
          original_order_number: r.orders?.order_number ?? null,
          customer_name: null,
          items_count: r.return_items.length,
          refund_total,
        }
      })
    },
    enabled: !!storeId,
    staleTime: 15_000,
  })
}

// ── useVariantSearch (para selector de cambio) ────────────────────────────────

export function useVariantSearch(query: string) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['returns', 'variant-search', storeId, dq],
    queryFn: async (): Promise<ExchangeVariantOption[]> => {
      if (dq.length < 2) return []

      type RawVar = {
        id: string
        product_id: string
        size: string | null
        color: string | null
        price: number
        stock_qty: number
        sku: string | null
        products: { name: string } | null
      }

      const toOption = (r: RawVar): ExchangeVariantOption => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.products?.name ?? '',
        size: r.size,
        color: r.color,
        price: r.price,
        stock_qty: r.stock_qty,
        sku: r.sku,
      })

      // Query 1: match by SKU, size, or color server-side
      const q1 = await supabase
        .from('variants')
        .select('id, product_id, size, color, price, stock_qty, sku, products(name)')
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .or(
          `sku.ilike.%${dq}%,size.ilike.%${dq}%,color.ilike.%${dq}%` as never,
        )
        .limit(50)

      if (q1.error) throw q1.error

      // Query 2: match by product name via products table
      const { data: productMatches, error: pErr } = await supabase
        .from('products')
        .select('id')
        .eq('store_id' as never, storeId)
        .ilike('name' as never, `%${dq}%`)
        .limit(20)

      if (pErr) throw pErr

      const productIds = (productMatches ?? []).map((p) => (p as { id: string }).id)

      let q2Results: RawVar[] = []
      if (productIds.length > 0) {
        const q2 = await supabase
          .from('variants')
          .select('id, product_id, size, color, price, stock_qty, sku, products(name)')
          .eq('store_id' as never, storeId)
          .eq('is_active' as never, true)
          .in('product_id' as never, productIds)
          .limit(50)

        if (q2.error) throw q2.error
        q2Results = (q2.data ?? []) as unknown as RawVar[]
      }

      // Merge and dedup by id
      const seen = new Map<string, ExchangeVariantOption>()
      for (const v of (q1.data ?? []) as unknown as RawVar[]) {
        seen.set(v.id, toOption(v))
      }
      for (const v of q2Results) {
        if (!seen.has(v.id)) seen.set(v.id, toOption(v))
      }

      return Array.from(seen.values()).slice(0, 50)
    },
    enabled: !!storeId && dq.length >= 2,
    staleTime: 20_000,
  })
}
