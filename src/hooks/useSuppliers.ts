import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useDebounce } from './useDebounce'
import type {
  Supplier,
  PurchaseInvoice,
  SupplierPayment,
  InvoiceStatus,
} from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupplierListItem extends Supplier {
  total_purchased: number
  pending_amount: number
  invoice_count: number
  last_invoice_date: string | null
}

export interface SupplierInvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  total: number
  paid_amount: number
  pending_amount: number
}

export interface SupplierDetailData {
  supplier: Supplier
  total_purchased: number
  pending_amount: number
  invoice_count: number
  last_invoice_date: string | null
  invoices: SupplierInvoiceRow[]
}

export interface SupplierListFilters {
  search?: string
  isActive?: boolean
}

// ── Raw shapes ────────────────────────────────────────────────────────────────

interface RawInvoiceLite {
  total: number
  paid_amount: number
  status: InvoiceStatus
  invoice_date: string
}

type RawSupplierWithInvoices = Supplier & {
  purchase_invoices: RawInvoiceLite[]
}

const SUPPLIER_COLUMNS =
  'id, store_id, name, nit, contact_name, phone, email, address, payment_terms_days, is_active, notes, created_at, updated_at'

// Agrega estadísticas de una lista de facturas de un proveedor.
function aggregateInvoices(invoices: RawInvoiceLite[]) {
  let total_purchased = 0
  let pending_amount = 0
  let last_invoice_date: string | null = null
  let invoice_count = 0
  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue
    invoice_count += 1
    total_purchased += Number(inv.total)
    pending_amount += Number(inv.total) - Number(inv.paid_amount)
    if (!last_invoice_date || inv.invoice_date > last_invoice_date) {
      last_invoice_date = inv.invoice_date
    }
  }
  return { total_purchased, pending_amount, invoice_count, last_invoice_date }
}

// ── useSupplierList ───────────────────────────────────────────────────────────

export function useSupplierList(filters: SupplierListFilters = {}) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce((filters.search ?? '').trim(), 300)
  const onlyActive = filters.isActive ?? true

  return useQuery({
    queryKey: ['suppliers', 'list', storeId, dq, onlyActive],
    queryFn: async (): Promise<SupplierListItem[]> => {
      let q = supabase
        .from('suppliers')
        .select(
          `${SUPPLIER_COLUMNS}, purchase_invoices(total, paid_amount, status, invoice_date)`,
        )
        .eq('store_id' as never, storeId)
        .order('name' as never, { ascending: true })
        .limit(200)

      if (onlyActive) {
        q = q.eq('is_active' as never, true)
      }
      if (dq.length >= 2) {
        q = q.or(
          `name.ilike.%${dq}%,nit.ilike.%${dq}%,phone.ilike.%${dq}%` as never,
        )
      }

      const { data, error } = await q
      if (error) throw error

      return (data ?? []).map((row) => {
        const r = row as unknown as RawSupplierWithInvoices
        const { purchase_invoices, ...supplier } = r
        const stats = aggregateInvoices(purchase_invoices ?? [])
        return { ...(supplier as Supplier), ...stats }
      })
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── useSupplierDetail ─────────────────────────────────────────────────────────

interface RawInvoiceFull extends PurchaseInvoice {
  supplier_payments: Pick<SupplierPayment, 'id'>[]
}

export function useSupplierDetail(id: string | null) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['suppliers', 'detail', id, storeId],
    queryFn: async (): Promise<SupplierDetailData | null> => {
      if (!id) return null

      const { data: supRaw, error: supErr } = await supabase
        .from('suppliers')
        .select(SUPPLIER_COLUMNS)
        .eq('id' as never, id)
        .eq('store_id' as never, storeId)
        .single()
      if (supErr) throw supErr
      const supplier = supRaw as unknown as Supplier

      const { data: invRaw, error: invErr } = await supabase
        .from('purchase_invoices')
        .select('*, supplier_payments(id)')
        .eq('supplier_id' as never, id)
        .eq('store_id' as never, storeId)
        .order('invoice_date' as never, { ascending: false })
      if (invErr) throw invErr

      const invoiceRows = (invRaw ?? []) as unknown as RawInvoiceFull[]

      const invoices: SupplierInvoiceRow[] = invoiceRows.map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        status: inv.status,
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        pending_amount: Number(inv.total) - Number(inv.paid_amount),
      }))

      const stats = aggregateInvoices(
        invoiceRows.map((inv) => ({
          total: Number(inv.total),
          paid_amount: Number(inv.paid_amount),
          status: inv.status,
          invoice_date: inv.invoice_date,
        })),
      )

      return {
        supplier,
        total_purchased: stats.total_purchased,
        pending_amount: stats.pending_amount,
        invoice_count: stats.invoice_count,
        last_invoice_date: stats.last_invoice_date,
        invoices,
      }
    },
    enabled: !!id && !!storeId,
    staleTime: 30_000,
  })
}
