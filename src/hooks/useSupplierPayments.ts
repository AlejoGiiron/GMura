import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { PaymentMethod } from '@/types/database.types'

export interface ShiftSupplierPayment {
  id: string
  amount: number
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  created_at: string
  invoice_id: string
  invoice_number: string
  supplier_name: string
}

interface RawShiftPayment {
  id: string
  amount: number
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  created_at: string
  invoice_id: string
  purchase_invoices: {
    invoice_number: string
    suppliers: { name: string } | null
  } | null
}

// Pagos a proveedores registrados durante un turno. Los pagos en efectivo
// también aparecen como cash_expense (creados por trigger) en el cuadre.
export function useShiftSupplierPayments(shiftId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['supplier-payments', 'shift', shiftId, storeId],
    queryFn: async (): Promise<ShiftSupplierPayment[]> => {
      if (!shiftId) return []
      const { data, error } = await supabase
        .from('supplier_payments')
        .select(
          'id, amount, payment_method, reference, notes, created_at, invoice_id, purchase_invoices(invoice_number, suppliers(name))',
        )
        .eq('store_id' as never, storeId)
        .eq('shift_id' as never, shiftId)
        .order('created_at' as never, { ascending: false })
      if (error) throw error

      return (data ?? []).map((row) => {
        const r = row as unknown as RawShiftPayment
        return {
          id: r.id,
          amount: Number(r.amount),
          payment_method: r.payment_method,
          reference: r.reference,
          notes: r.notes,
          created_at: r.created_at,
          invoice_id: r.invoice_id,
          invoice_number: r.purchase_invoices?.invoice_number ?? '—',
          supplier_name: r.purchase_invoices?.suppliers?.name ?? '—',
        }
      })
    },
    enabled: !!shiftId && !!storeId,
    staleTime: 15_000,
  })
}
