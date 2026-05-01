import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useDebounce } from './useDebounce'
import type { Customer, PaymentMethod, OrderStatus, ReturnType, ReturnStatus } from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerListItem = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  document_id: string | null
  notes: string | null
  created_at: string
  total_spent: number
  order_count: number
  last_visit: string | null
}

export type CustomerOrderItem = {
  id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
  product_name: string
  size: string | null
  color: string | null
}

export type CustomerOrder = {
  id: string
  created_at: string
  total: number
  payment_method: PaymentMethod
  status: OrderStatus
  items: CustomerOrderItem[]
  has_returns: boolean
}

export type CustomerReturn = {
  id: string
  created_at: string
  type: ReturnType
  status: ReturnStatus
  original_order_id: string
  refund_total: number
}

export type CustomerProfile = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  document_id: string | null
  notes: string | null
  created_at: string
  total_spent: number
  order_count: number
  last_visit: string | null
  orders: CustomerOrder[]
  returns: CustomerReturn[]
}

// ── Raw shapes ────────────────────────────────────────────────────────────────

type RawListOrder = { id: string; total: number; created_at: string; status: string }

type RawCustomerList = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  document_id: string | null
  notes: string | null
  created_at: string
  orders: RawListOrder[]
}

type RawOrderItem = {
  id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
  variants: {
    size: string | null
    color: string | null
    products: { name: string } | null
  } | null
}

type RawOrderWithItems = {
  id: string
  created_at: string
  total: number
  payment_method: string
  status: string
  order_items: RawOrderItem[]
  returns: { id: string }[]
}

type RawReturnRow = {
  id: string
  created_at: string
  type: string
  status: string
  original_order_id: string
  return_items: { qty: number; unit_price: number }[]
}

// ── useCustomerSearch ─────────────────────────────────────────────────────────

export function useCustomerSearch(query: string) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['customer-search', storeId, dq],
    queryFn: async (): Promise<Customer[]> => {
      if (dq.length < 2) return []
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('store_id' as never, storeId)
        .or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%` as never)
        .limit(8)
      if (error) throw error
      return (data ?? []) as unknown as Customer[]
    },
    enabled: !!storeId && dq.length >= 2,
    staleTime: 10_000,
  })
}

// ── useCustomerList ───────────────────────────────────────────────────────────

export function useCustomerList(query: string) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['customers', 'list', storeId, dq],
    queryFn: async (): Promise<CustomerListItem[]> => {
      let q = supabase
        .from('customers')
        .select(
          'id, full_name, phone, email, document_id, notes, created_at, orders(id, total, created_at, status)',
        )
        .eq('store_id' as never, storeId)
        .order('full_name' as never, { ascending: true })
        .limit(100)

      if (dq.length >= 2) {
        q = q.or(
          `full_name.ilike.%${dq}%,phone.ilike.%${dq}%,document_id.ilike.%${dq}%` as never,
        )
      }

      const { data, error } = await q
      if (error) throw error

      return (data ?? []).map((row) => {
        const r = row as unknown as RawCustomerList
        const completed = r.orders.filter((o) => o.status === 'completed')
        const total_spent = completed.reduce((s, o) => s + o.total, 0)
        const allDates = r.orders.map((o) => o.created_at).sort().reverse()
        return {
          id: r.id,
          full_name: r.full_name,
          phone: r.phone,
          email: r.email,
          document_id: r.document_id,
          notes: r.notes,
          created_at: r.created_at,
          total_spent,
          order_count: completed.length,
          last_visit: allDates[0] ?? null,
        }
      })
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── useCustomerProfile ────────────────────────────────────────────────────────

export function useCustomerProfile(customerId: string | null) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['customers', 'profile', customerId],
    queryFn: async (): Promise<CustomerProfile | null> => {
      if (!customerId) return null

      const { data: custRaw, error: custErr } = await supabase
        .from('customers')
        .select('id, full_name, phone, email, document_id, notes, created_at')
        .eq('id' as never, customerId)
        .single()
      if (custErr) throw custErr

      const { data: ordersRaw, error: ordersErr } = await supabase
        .from('orders')
        .select(`
          id, created_at, total, payment_method, status,
          order_items(id, variant_id, product_id, qty, unit_price,
            variants(size, color, products(name))),
          returns(id)
        `)
        .eq('customer_id' as never, customerId)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
        .limit(50)
      if (ordersErr) throw ordersErr

      const orderIds = (ordersRaw ?? []).map((o) => (o as unknown as { id: string }).id)
      let returnsRows: RawReturnRow[] = []
      if (orderIds.length > 0) {
        const { data: retData, error: retErr } = await supabase
          .from('returns')
          .select('id, created_at, type, status, original_order_id, return_items(qty, unit_price)')
          .in('original_order_id' as never, orderIds)
          .order('created_at' as never, { ascending: false })
        if (retErr) throw retErr
        returnsRows = (retData ?? []) as unknown as RawReturnRow[]
      }

      const orders: CustomerOrder[] = (ordersRaw ?? []).map((o) => {
        const raw = o as unknown as RawOrderWithItems
        return {
          id: raw.id,
          created_at: raw.created_at,
          total: raw.total,
          payment_method: raw.payment_method as PaymentMethod,
          status: raw.status as OrderStatus,
          has_returns: raw.returns.length > 0,
          items: raw.order_items.map((oi) => ({
            id: oi.id,
            variant_id: oi.variant_id,
            product_id: oi.product_id,
            qty: oi.qty,
            unit_price: oi.unit_price,
            product_name: oi.variants?.products?.name ?? 'Producto eliminado',
            size: oi.variants?.size ?? null,
            color: oi.variants?.color ?? null,
          })),
        }
      })

      const returns: CustomerReturn[] = returnsRows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        type: r.type as ReturnType,
        status: r.status as ReturnStatus,
        original_order_id: r.original_order_id,
        refund_total: r.return_items.reduce((s, ri) => s + ri.qty * ri.unit_price, 0),
      }))

      const completed = orders.filter((o) => o.status === 'completed')
      const c = custRaw as unknown as {
        id: string
        full_name: string
        phone: string | null
        email: string | null
        document_id: string | null
        notes: string | null
        created_at: string
      }

      return {
        id: c.id,
        full_name: c.full_name,
        phone: c.phone,
        email: c.email,
        document_id: c.document_id,
        notes: c.notes,
        created_at: c.created_at,
        total_spent: completed.reduce((s, o) => s + o.total, 0),
        order_count: completed.length,
        last_visit: orders[0]?.created_at ?? null,
        orders,
        returns,
      }
    },
    enabled: !!customerId && !!storeId,
    staleTime: 30_000,
  })
}
