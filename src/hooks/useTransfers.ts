import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type {
  Transfer,
  TransferItem,
  TransferStatus,
  TransferMatchKind,
} from '@/types/database.types'

export const TRANSFER_PAGE_SIZE = 50

// ── Tipos públicos ────────────────────────────────────────────────────────────

/**
 * Dirección desde la perspectiva de la tienda ACTIVA:
 *  - outgoing: los que MANDO (from_store_id = mi tienda)
 *  - incoming: los que RECIBO (to_store_id = mi tienda)
 * El RLS ya limita a los traslados donde alguna de mis tiendas participa; esto
 * es el filtro de la pestaña, no el de seguridad.
 */
export type TransferDirection = 'outgoing' | 'incoming' | 'all'

export type TransferStatusFilter = TransferStatus | 'all'

export interface TransferListFilters {
  direction: TransferDirection
  status: TransferStatusFilter
  page: number
}

export interface TransferListRow extends Transfer {
  from_store_name: string
  to_store_name: string
  created_by_name: string | null
  received_by_name: string | null
  /** Tienda desde la que se confirmó la recepción (columna de auditoría). */
  received_by_store_name: string | null
  item_count: number
  total_qty: number
  /** sum(qty_sent × unit_price) — valor a precio de venta (handoff §0.4). */
  total_value: number
  /** count(dest_action = 'create_product') — se oculta en la UI si es 0. */
  new_products_count: number
  /** true si la tienda activa es el origen (para decidir qué acciones ofrecer). */
  is_outgoing: boolean
}

export interface TransferDetail extends Transfer {
  from_store_name: string
  to_store_name: string
  created_by_name: string | null
  dispatched_by_name: string | null
  received_by_name: string | null
  cancelled_by_name: string | null
  items: TransferDetailItem[]
}

export interface TransferDetailItem extends TransferItem {
  /** Código de barras de la variante DESTINO (para reimprimir etiquetas). */
  to_barcode: string | null
}

export interface TransferTarget {
  product_id: string
  product_name: string
  brand: string | null
  description: string | null
  variant_id: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  is_active: boolean
  match_kind: TransferMatchKind
}

const SELECT_LIST =
  'id, transfer_number, organization_id, from_store_id, to_store_id, status, ' +
  'carrier, tracking_ref, notes, created_by, created_at, updated_at, ' +
  'dispatched_by, dispatched_at, received_by, received_at, received_by_store_id, ' +
  'cancelled_by, cancelled_at, cancel_reason'

type StoreRef = { id: string; name: string }
type ProfileRef = { id: string; full_name: string }

/** Resuelve los nombres de tienda y de persona sin N+1: una query por lote. */
async function resolveNames(rows: Transfer[]) {
  const storeIds = new Set<string>()
  const userIds = new Set<string>()
  for (const t of rows) {
    storeIds.add(t.from_store_id)
    storeIds.add(t.to_store_id)
    if (t.received_by_store_id) storeIds.add(t.received_by_store_id)
    if (t.created_by) userIds.add(t.created_by)
    if (t.dispatched_by) userIds.add(t.dispatched_by)
    if (t.received_by) userIds.add(t.received_by)
    if (t.cancelled_by) userIds.add(t.cancelled_by)
  }

  const [storesRes, profilesRes] = await Promise.all([
    storeIds.size
      ? supabase.from('stores').select('id, name').in('id' as never, [...storeIds])
      : Promise.resolve({ data: [], error: null }),
    userIds.size
      ? supabase.from('profiles').select('id, full_name').in('id' as never, [...userIds])
      : Promise.resolve({ data: [], error: null }),
  ])

  const stores = new Map<string, string>(
    ((storesRes.data ?? []) as StoreRef[]).map((s) => [s.id, s.name]),
  )
  const people = new Map<string, string>(
    ((profilesRes.data ?? []) as ProfileRef[]).map((p) => [p.id, p.full_name]),
  )
  return { stores, people }
}

// ── useTransferList ───────────────────────────────────────────────────────────

export function useTransferList(filters: TransferListFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['transfers', storeId, filters],
    queryFn: async (): Promise<{ rows: TransferListRow[]; total: number }> => {
      const from = filters.page * TRANSFER_PAGE_SIZE
      const to = from + TRANSFER_PAGE_SIZE - 1

      let query = supabase
        .from('transfers')
        .select(SELECT_LIST, { count: 'exact' })
        .order('created_at' as never, { ascending: false })
        .range(from, to)

      if (filters.direction === 'outgoing') {
        query = query.eq('from_store_id' as never, storeId)
      } else if (filters.direction === 'incoming') {
        query = query.eq('to_store_id' as never, storeId)
      }
      if (filters.status !== 'all') {
        query = query.eq('status' as never, filters.status)
      }

      const { data, error, count } = await query
      if (error) throw error

      const rows = (data ?? []) as unknown as Transfer[]
      if (rows.length === 0) return { rows: [], total: count ?? 0 }

      const { stores, people } = await resolveNames(rows)

      // Agregados por traslado: una sola query para toda la página, sin N+1.
      const { data: itemsData, error: itemsErr } = await supabase
        .from('transfer_items')
        .select('transfer_id, qty_sent, unit_price, dest_action')
        .in('transfer_id' as never, rows.map((r) => r.id))
      if (itemsErr) throw itemsErr

      type ItemAgg = { transfer_id: string; qty_sent: number; unit_price: number; dest_action: string }
      const agg = new Map<string, { n: number; qty: number; value: number; nuevas: number }>()
      for (const i of (itemsData ?? []) as ItemAgg[]) {
        const prev = agg.get(i.transfer_id) ?? { n: 0, qty: 0, value: 0, nuevas: 0 }
        agg.set(i.transfer_id, {
          n: prev.n + 1,
          qty: prev.qty + i.qty_sent,
          value: prev.value + i.qty_sent * Number(i.unit_price),
          nuevas: prev.nuevas + (i.dest_action === 'create_product' ? 1 : 0),
        })
      }

      return {
        rows: rows.map((t) => ({
          ...t,
          from_store_name: stores.get(t.from_store_id) ?? '—',
          to_store_name: stores.get(t.to_store_id) ?? '—',
          created_by_name: t.created_by ? (people.get(t.created_by) ?? null) : null,
          received_by_name: t.received_by ? (people.get(t.received_by) ?? null) : null,
          received_by_store_name: t.received_by_store_id
            ? (stores.get(t.received_by_store_id) ?? null)
            : null,
          item_count: agg.get(t.id)?.n ?? 0,
          total_qty: agg.get(t.id)?.qty ?? 0,
          total_value: agg.get(t.id)?.value ?? 0,
          new_products_count: agg.get(t.id)?.nuevas ?? 0,
          is_outgoing: t.from_store_id === storeId,
        })),
        total: count ?? 0,
      }
    },
    enabled: !!storeId,
  })
}

// ── useIncomingTransfersCount ─────────────────────────────────────────────────
// Badge del sidebar: cuántos vienen en camino hacia mi tienda activa.

export function useIncomingTransfersCount() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['transfers-incoming-count', storeId],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .eq('to_store_id' as never, storeId)
        .eq('status' as never, 'in_transit')
      if (error) throw error
      return count ?? 0
    },
    enabled: !!storeId,
  })
}

// ── useTransferStatusCounts ───────────────────────────────────────────────────
// Conteos de los chips de filtro. Un head:true por estado: son 4 consultas sin
// payload, más barato que traer todas las filas para contarlas en el cliente.

export type TransferStatusCounts = Record<TransferStatus | 'all', number>

export function useTransferStatusCounts(direction: TransferDirection) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['transfer-status-counts', storeId, direction],
    queryFn: async (): Promise<TransferStatusCounts> => {
      const statuses: TransferStatus[] = ['draft', 'in_transit', 'received', 'cancelled']

      const countFor = async (status?: TransferStatus) => {
        let q = supabase.from('transfers').select('id', { count: 'exact', head: true })
        if (direction === 'outgoing') q = q.eq('from_store_id' as never, storeId)
        else if (direction === 'incoming') q = q.eq('to_store_id' as never, storeId)
        if (status) q = q.eq('status' as never, status)
        const { count, error } = await q
        if (error) throw error
        return count ?? 0
      }

      const [all, ...rest] = await Promise.all([
        countFor(),
        ...statuses.map((s) => countFor(s)),
      ])
      return {
        all,
        draft: rest[0],
        in_transit: rest[1],
        received: rest[2],
        cancelled: rest[3],
      }
    },
    enabled: !!storeId,
  })
}

// ── useTransferDetail ─────────────────────────────────────────────────────────

export function useTransferDetail(transferId: string | null) {
  return useQuery({
    queryKey: ['transfer-detail', transferId],
    queryFn: async (): Promise<TransferDetail | null> => {
      if (!transferId) return null

      const { data, error } = await supabase
        .from('transfers')
        .select(SELECT_LIST)
        .eq('id' as never, transferId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null

      const t = data as unknown as Transfer
      const { stores, people } = await resolveNames([t])

      // `to_barcode` sale de un join embebido sobre `variants`, que respeta el
      // RLS de esa tabla (store_id = tienda activa). Consecuencia BUSCADA:
      //   · parado en el DESTINO  → los códigos resuelven (es quien imprime)
      //   · parado en el ORIGEN   → llegan en NULL
      // Está bien así: el origen no imprime las etiquetas del destino, y el
      // bloque de reimpresión se oculta solo porque `labelsReady` es false.
      // NO se arregla debilitando el RLS de variants ni snapshotéando el
      // barcode: el código del destino puede cambiar y el snapshot mentiría.
      const { data: itemsData, error: itemsErr } = await supabase
        .from('transfer_items')
        .select('*, variants!transfer_items_to_variant_id_fkey(barcode)')
        .eq('transfer_id' as never, transferId)
        .order('created_at' as never, { ascending: true })
      if (itemsErr) throw itemsErr

      type ItemRow = TransferItem & { variants: { barcode: string | null } | null }

      return {
        ...t,
        from_store_name: stores.get(t.from_store_id) ?? '—',
        to_store_name: stores.get(t.to_store_id) ?? '—',
        created_by_name: t.created_by ? (people.get(t.created_by) ?? null) : null,
        dispatched_by_name: t.dispatched_by ? (people.get(t.dispatched_by) ?? null) : null,
        received_by_name: t.received_by ? (people.get(t.received_by) ?? null) : null,
        cancelled_by_name: t.cancelled_by ? (people.get(t.cancelled_by) ?? null) : null,
        items: ((itemsData ?? []) as unknown as ItemRow[]).map((i) => ({
          ...i,
          to_barcode: i.variants?.barcode ?? null,
        })),
      }
    },
    enabled: !!transferId,
  })
}

// ── useTransferTargets ────────────────────────────────────────────────────────
// Sugerencias de mapeo en el catálogo del DESTINO. Es la única forma de que el
// origen "vea" catálogo ajeno: el RLS se lo tapa, y esta RPC SECURITY DEFINER lo
// permite acotado a la misma organización y con el permiso traslados.gestionar.

export function useTransferTargets(
  toStoreId: string | null,
  fromVariantId: string | null,
  query: string | null,
) {
  const enabled = !!toStoreId && (!!fromVariantId || (query ?? '').trim().length >= 2)

  return useQuery({
    queryKey: ['transfer-targets', toStoreId, fromVariantId, query],
    queryFn: async (): Promise<TransferTarget[]> => {
      const { data, error } = await supabase.rpc('search_transfer_targets' as never, {
        p_to_store_id: toStoreId,
        p_from_variant_id: fromVariantId,
        p_query: fromVariantId ? null : (query ?? '').trim(),
      } as never)
      if (error) throw error
      return (data ?? []) as unknown as TransferTarget[]
    },
    enabled,
  })
}
