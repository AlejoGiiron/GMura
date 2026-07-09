import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useDebounce } from './useDebounce'
import type {
  Layaway,
  LayawayStatus,
  PaymentMethod,
} from '@/types/database.types'

export const LAYAWAY_PAGE_SIZE = 50

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type LayawayStatusFilter = LayawayStatus | 'all' | 'expiring_soon'

export interface LayawayListFilters {
  status: LayawayStatusFilter
  search: string
  customerId?: string | null
  expiringWithinDays?: number
  page: number
}

export interface LayawayListRow {
  id: string
  layaway_number: number
  status: LayawayStatus
  total: number
  paid_amount: number
  expires_at: string
  created_at: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  days_until_expiry: number
  paid_percent: number
}

export interface LayawayListResult {
  rows: LayawayListRow[]
  totalCount: number
}

export interface LayawayDetailItem {
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

export interface LayawayDetailPayment {
  id: string
  amount: number
  payment_method: PaymentMethod
  notes: string | null
  created_at: string
  created_by: string
  created_by_name: string | null
  // true = abono ya recibido antes de cargar el separado (028); no entró a caja.
  is_historical: boolean
}

export interface LayawayDetail extends Layaway {
  customer_name: string
  customer_phone: string | null
  created_by_name: string | null
  items: LayawayDetailItem[]
  payments: LayawayDetailPayment[]
  balance_pending: number
}

export interface LayawayStatusCounts {
  all: number
  active: number
  expiring_soon: number
  completed: number
  cancelled: number
  expired: number
}

// ── Raw shapes ────────────────────────────────────────────────────────────────

interface RawLayawayListRow {
  id: string
  layaway_number: number
  status: LayawayStatus
  total: number
  paid_amount: number
  expires_at: string
  created_at: string
  customer_id: string
  customers: { full_name: string; phone: string | null } | null
}

interface RawDetailItem {
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
}

interface RawDetailPayment {
  id: string
  amount: number
  payment_method: PaymentMethod
  notes: string | null
  created_at: string
  created_by: string
  is_historical: boolean
  profiles: { full_name: string } | null
}

interface RawDetailLayaway extends Layaway {
  customers: { full_name: string; phone: string | null } | null
  profiles: { full_name: string } | null
  layaway_items: RawDetailItem[]
  layaway_payments: RawDetailPayment[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000

function diffInDays(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now()
  return Math.floor(diff / MS_PER_DAY)
}

function isNumericSearch(s: string): boolean {
  return /^#?\d+$/.test(s.trim())
}

function normalizeNumeric(s: string): number {
  return parseInt(s.replace(/^#/, ''), 10)
}

// ── useLayawayList ────────────────────────────────────────────────────────────

export function useLayawayList(filters: LayawayListFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const dq = useDebounce(filters.search.trim(), 300)

  return useQuery<LayawayListResult>({
    queryKey: [
      'layaways',
      'list',
      storeId,
      filters.status,
      dq,
      filters.customerId ?? '',
      filters.expiringWithinDays ?? 0,
      filters.page,
    ],
    queryFn: async () => {
      // Búsqueda por texto requiere 2 queries (PostgREST no soporta
      // OR sobre tabla referenciada de forma portable entre versiones).
      let customerIdFilter: string[] | null = null
      if (dq.length >= 2 && !isNumericSearch(dq)) {
        const { data: custs, error: custErr } = await supabase
          .from('customers')
          .select('id')
          .eq('store_id' as never, storeId)
          .or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%` as never)
          .limit(200)
        if (custErr) throw custErr
        customerIdFilter = (custs ?? []).map(
          (c) => (c as unknown as { id: string }).id,
        )
        if (customerIdFilter.length === 0) {
          return { rows: [], totalCount: 0 }
        }
      }

      let q = supabase
        .from('layaways')
        .select(
          'id, layaway_number, status, total, paid_amount, expires_at, created_at, customer_id, customers(full_name, phone)',
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)

      if (filters.status === 'expiring_soon') {
        const limit = new Date(Date.now() + 7 * MS_PER_DAY).toISOString()
        q = q
          .eq('status' as never, 'active' as never)
          .lte('expires_at' as never, limit as never)
      } else if (filters.status !== 'all') {
        q = q.eq('status' as never, filters.status as never)
      }

      if (filters.customerId) {
        q = q.eq('customer_id' as never, filters.customerId as never)
      }

      if (
        filters.expiringWithinDays !== undefined &&
        filters.expiringWithinDays > 0
      ) {
        const limit = new Date(
          Date.now() + filters.expiringWithinDays * MS_PER_DAY,
        ).toISOString()
        q = q.lte('expires_at' as never, limit as never)
      }

      if (dq.length > 0) {
        if (isNumericSearch(dq)) {
          q = q.eq('layaway_number' as never, normalizeNumeric(dq) as never)
        } else if (customerIdFilter) {
          q = q.in('customer_id' as never, customerIdFilter as never)
        }
      }

      const from = filters.page * LAYAWAY_PAGE_SIZE
      const to = from + LAYAWAY_PAGE_SIZE - 1
      const { data, error, count } = await q
        .order('created_at' as never, { ascending: false })
        .range(from, to)

      if (error) throw error

      const rows: LayawayListRow[] = (data ?? []).map((raw) => {
        const r = raw as unknown as RawLayawayListRow
        const total = Number(r.total) || 0
        const paid = Number(r.paid_amount) || 0
        return {
          id: r.id,
          layaway_number: r.layaway_number,
          status: r.status,
          total,
          paid_amount: paid,
          expires_at: r.expires_at,
          created_at: r.created_at,
          customer_id: r.customer_id,
          customer_name: r.customers?.full_name ?? 'Cliente eliminado',
          customer_phone: r.customers?.phone ?? null,
          days_until_expiry: diffInDays(r.expires_at),
          paid_percent: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
        }
      })

      return { rows, totalCount: count ?? rows.length }
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── useLayawayDetail ──────────────────────────────────────────────────────────

export function useLayawayDetail(id: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<LayawayDetail | null>({
    queryKey: ['layaways', 'detail', id, storeId],
    queryFn: async () => {
      if (!id) return null
      const { data, error } = await supabase
        .from('layaways')
        .select(
          `*,
           customers(full_name, phone),
           profiles!layaways_created_by_fkey(full_name),
           layaway_items(id, variant_id, product_id, qty, unit_price, list_price,
             variants(size, color, products(name, brand))),
           layaway_payments(id, amount, payment_method, notes, created_at, created_by,
             is_historical, profiles(full_name))`,
        )
        .eq('id' as never, id)
        .eq('store_id' as never, storeId)
        .single()

      if (error) throw error
      const r = data as unknown as RawDetailLayaway

      const items: LayawayDetailItem[] = (r.layaway_items ?? []).map((it) => ({
        id: it.id,
        variant_id: it.variant_id,
        product_id: it.product_id,
        qty: it.qty,
        unit_price: Number(it.unit_price) || 0,
        list_price: Number(it.list_price) || 0,
        product_name: it.variants?.products?.name ?? 'Producto eliminado',
        brand: it.variants?.products?.brand ?? null,
        size: it.variants?.size ?? null,
        color: it.variants?.color ?? null,
      }))

      const payments: LayawayDetailPayment[] = (r.layaway_payments ?? [])
        .map((p) => ({
          id: p.id,
          amount: Number(p.amount) || 0,
          payment_method: p.payment_method,
          notes: p.notes,
          created_at: p.created_at,
          created_by: p.created_by,
          created_by_name: p.profiles?.full_name ?? null,
          is_historical: p.is_historical === true,
        }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

      const total = Number(r.total) || 0
      const paid = Number(r.paid_amount) || 0

      return {
        ...r,
        total,
        paid_amount: paid,
        customer_name: r.customers?.full_name ?? 'Cliente eliminado',
        customer_phone: r.customers?.phone ?? null,
        created_by_name: r.profiles?.full_name ?? null,
        items,
        payments,
        balance_pending: Math.max(0, total - paid),
      }
    },
    enabled: !!id && !!storeId,
    staleTime: 10_000,
  })
}

// ── useCustomerLayaways ───────────────────────────────────────────────────────
// Lista (todos los estados) de los separados de un cliente. Útil para el
// tab "Separados" del detalle de cliente en CustomersPage.

export interface CustomerLayawayRow {
  id: string
  layaway_number: number
  status: LayawayStatus
  total: number
  paid_amount: number
  pending_amount: number
  created_at: string
  expires_at: string
  items_count: number
}

interface RawCustomerLayaway {
  id: string
  layaway_number: number
  status: LayawayStatus
  total: number
  paid_amount: number
  created_at: string
  expires_at: string
  layaway_items: { id: string }[]
}

export function useCustomerLayaways(customerId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CustomerLayawayRow[]>({
    queryKey: ['layaways', 'by-customer', customerId, storeId],
    queryFn: async () => {
      if (!customerId) return []
      const { data, error } = await supabase
        .from('layaways')
        .select(`
          id, layaway_number, status, total, paid_amount, created_at, expires_at,
          layaway_items(id)
        `)
        .eq('store_id' as never, storeId)
        .eq('customer_id' as never, customerId)
        .order('created_at' as never, { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => {
        const r = row as unknown as RawCustomerLayaway
        const total = Number(r.total) || 0
        const paid = Number(r.paid_amount) || 0
        return {
          id: r.id,
          layaway_number: r.layaway_number,
          status: r.status,
          total,
          paid_amount: paid,
          pending_amount: Math.max(0, total - paid),
          created_at: r.created_at,
          expires_at: r.expires_at,
          items_count: (r.layaway_items ?? []).length,
        }
      })
    },
    enabled: !!customerId && !!storeId,
    staleTime: 30_000,
  })
}

// ── useActiveLayawaysCount ────────────────────────────────────────────────────

export function useActiveLayawaysCount() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<number>({
    queryKey: ['active-layaways-count', storeId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('layaways')
        .select('id' as never, { count: 'exact', head: true })
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'active' as never)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── useLayawayStatusCounts (para tabs de la página) ──────────────────────────

export function useLayawayStatusCounts() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<LayawayStatusCounts>({
    queryKey: ['layaways', 'status-counts', storeId],
    queryFn: async () => {
      const limit7d = new Date(Date.now() + 7 * MS_PER_DAY).toISOString()

      const headCount = async (
        statusFilter?: LayawayStatus,
        expiringLimit?: string,
      ): Promise<number> => {
        let q = supabase
          .from('layaways')
          .select('id' as never, { count: 'exact', head: true })
          .eq('store_id' as never, storeId)
        if (statusFilter) q = q.eq('status' as never, statusFilter as never)
        if (expiringLimit) q = q.lte('expires_at' as never, expiringLimit as never)
        const { count, error } = await q
        if (error) throw error
        return count ?? 0
      }

      const [all, active, expiring_soon, completed, cancelled, expired] =
        await Promise.all([
          headCount(),
          headCount('active'),
          headCount('active', limit7d),
          headCount('completed'),
          headCount('cancelled'),
          headCount('expired'),
        ])

      return { all, active, expiring_soon, completed, cancelled, expired }
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}
