import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useCurrentShift } from './useCashShift'
import { fmtCOP } from '@/lib/formatters'
import { todayDateString } from '@/lib/invoices'
import type { PaymentMethod, PurchaseInvoice } from '@/types/database.types'

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface NewInvoiceItem {
  variant_id: string
  product_id: string
  qty: number
  unit_cost: number
  subtotal: number
  update_cost: boolean
}

export interface CreateInvoiceInput {
  supplier_id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  items: NewInvoiceItem[]
  tax: number
  notes: string
  initial_payment?: {
    amount: number
    method: PaymentMethod
    reference: string
    notes: string
  }
}

export interface RegisterPaymentInput {
  invoice_id: string
  amount: number
  method: PaymentMethod
  reference: string
  notes: string
  payment_date: string
}

export interface CancelInvoiceInput {
  id: string
  reason: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PostgrestLikeError {
  code?: string
  message: string
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as PostgrestLikeError).code === '23505'
  )
}

function invalidateInvoiceWriteQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] })
  void queryClient.invalidateQueries({ queryKey: ['suppliers'] })
  void queryClient.invalidateQueries({ queryKey: ['supplier-payments'] })
  void queryClient.invalidateQueries({ queryKey: ['variants'] })
  void queryClient.invalidateQueries({ queryKey: ['products'] })
  void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
  void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
  void queryClient.invalidateQueries({ queryKey: ['inventory'] })
  void queryClient.invalidateQueries({ queryKey: ['shift-expenses'] })
  void queryClient.invalidateQueries({ queryKey: ['shift-closing'] })
}

// ── useCreateInvoice ──────────────────────────────────────────────────────────

export function useCreateInvoice() {
  const { profile } = useAuth()
  const { data: currentShift } = useCurrentShift()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateInvoiceInput): Promise<PurchaseInvoice> => {
      const storeId = profile?.store_id
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (!input.supplier_id) throw new Error('Selecciona un proveedor')
      if (!input.invoice_number.trim()) {
        throw new Error('Ingresa el número de factura')
      }
      if (!input.invoice_date) throw new Error('Ingresa la fecha de la factura')
      if (!input.items.length) {
        throw new Error('Agrega al menos un ítem a la factura')
      }
      for (const it of input.items) {
        if (!it.variant_id || !it.product_id) {
          throw new Error('Ítem inválido en la factura')
        }
        if (it.qty <= 0) throw new Error('La cantidad debe ser mayor a cero')
        if (it.unit_cost < 0) throw new Error('El costo no puede ser negativo')
      }
      const tax = input.tax || 0
      if (tax < 0) throw new Error('El impuesto no puede ser negativo')

      const subtotal = input.items.reduce((s, it) => s + it.qty * it.unit_cost, 0)
      const total = subtotal + tax

      // Validar abono inicial contra el total
      if (input.initial_payment) {
        if (input.initial_payment.amount <= 0) {
          throw new Error('El abono inicial debe ser mayor a cero')
        }
        if (input.initial_payment.amount > total) {
          throw new Error('El abono inicial no puede superar el total')
        }
      }

      // 1. INSERT cabecera
      let invoice: PurchaseInvoice
      try {
        const { data: invRow, error: invErr } = await supabase
          .from('purchase_invoices')
          .insert({
            store_id: storeId,
            supplier_id: input.supplier_id,
            created_by: userId,
            invoice_number: input.invoice_number.trim(),
            invoice_date: input.invoice_date,
            due_date: input.due_date || null,
            subtotal,
            tax,
            total,
            notes: input.notes.trim() || null,
          } as never)
          .select()
          .single()
        if (invErr) throw invErr
        invoice = invRow as unknown as PurchaseInvoice
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Error(
            'Ya existe una factura con ese número para este proveedor',
          )
        }
        throw err
      }

      // 2. INSERT items (trigger incrementa stock + cost_price si update_cost)
      const { error: itemsErr } = await supabase
        .from('purchase_invoice_items')
        .insert(
          input.items.map((it) => ({
            invoice_id: invoice.id,
            variant_id: it.variant_id,
            product_id: it.product_id,
            qty: it.qty,
            unit_cost: it.unit_cost,
            subtotal: it.qty * it.unit_cost,
            update_cost: it.update_cost,
          })) as never,
        )

      if (itemsErr) {
        // Rollback compensatorio: borrar la factura huérfana.
        const { error: rbErr } = await supabase
          .from('purchase_invoices')
          .delete()
          .eq('id' as never, invoice.id)
        if (rbErr) {
          console.error('[useCreateInvoice] rollback falló', rbErr)
        }
        throw new Error(`No se pudieron registrar los ítems: ${itemsErr.message}`)
      }

      // 3. Abono inicial opcional (trigger actualiza status; si es efectivo
      //    durante turno abierto, otro trigger crea el cash_expense)
      if (input.initial_payment) {
        const { error: payErr } = await supabase
          .from('supplier_payments')
          .insert({
            invoice_id: invoice.id,
            store_id: storeId,
            amount: input.initial_payment.amount,
            payment_method: input.initial_payment.method,
            payment_date: input.invoice_date,
            reference: input.initial_payment.reference.trim() || null,
            notes: input.initial_payment.notes.trim() || null,
            created_by: userId,
            shift_id: currentShift?.id ?? null,
          } as never)
        if (payErr) {
          // La factura y el stock ya quedaron OK; solo falló el abono.
          toast.error(
            `Factura creada, pero el abono no se registró: ${payErr.message}`,
          )
        }
      }

      return invoice
    },
    onSuccess: (invoice) => {
      invalidateInvoiceWriteQueries(queryClient)
      toast.success(`Factura ${invoice.invoice_number} registrada`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useRegisterPayment ────────────────────────────────────────────────────────

export function useRegisterPayment() {
  const { profile } = useAuth()
  const { data: currentShift } = useCurrentShift()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegisterPaymentInput) => {
      const storeId = profile?.store_id
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (input.amount <= 0) throw new Error('El monto debe ser mayor a cero')

      // 1. Cargar factura y validar saldo
      const { data: invRaw, error: invErr } = await supabase
        .from('purchase_invoices')
        .select('total, paid_amount, status')
        .eq('id' as never, input.invoice_id)
        .eq('store_id' as never, storeId)
        .single()
      if (invErr || !invRaw) throw new Error('Factura no encontrada')

      const inv = invRaw as unknown as {
        total: number
        paid_amount: number
        status: string
      }
      if (inv.status === 'cancelled') {
        throw new Error('No se pueden registrar pagos en una factura cancelada')
      }
      if (inv.status === 'paid') {
        throw new Error('Esta factura ya está pagada en su totalidad')
      }
      const remaining = Number(inv.total) - Number(inv.paid_amount)
      if (input.amount > remaining + 0.5) {
        throw new Error(
          `El pago no puede superar el saldo pendiente (${fmtCOP(remaining)})`,
        )
      }

      // 2. INSERT pago (triggers actualizan status y, si es efectivo en turno
      //    abierto, generan el cash_expense)
      const { error: payErr } = await supabase
        .from('supplier_payments')
        .insert({
          invoice_id: input.invoice_id,
          store_id: storeId,
          amount: input.amount,
          payment_method: input.method,
          payment_date: input.payment_date || todayDateString(),
          reference: input.reference.trim() || null,
          notes: input.notes.trim() || null,
          created_by: userId,
          shift_id: currentShift?.id ?? null,
        } as never)
      if (payErr) {
        throw new Error(`No se pudo registrar el pago: ${payErr.message}`)
      }
    },
    onSuccess: (_data, input) => {
      invalidateInvoiceWriteQueries(queryClient)
      void queryClient.invalidateQueries({
        queryKey: ['purchase-invoices', 'detail', input.invoice_id],
      })
      toast.success(`Pago ${fmtCOP(input.amount)} registrado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useCancelInvoice ──────────────────────────────────────────────────────────

export function useCancelInvoice() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CancelInvoiceInput) => {
      const storeId = profile?.store_id
      if (!storeId) throw new Error('Sesión inválida')

      const { data: invRaw, error: invErr } = await supabase
        .from('purchase_invoices')
        .select(
          'paid_amount, status, notes, purchase_invoice_items(id)',
        )
        .eq('id' as never, input.id)
        .eq('store_id' as never, storeId)
        .single()
      if (invErr || !invRaw) throw new Error('Factura no encontrada')

      const inv = invRaw as unknown as {
        paid_amount: number
        status: string
        notes: string | null
        purchase_invoice_items: { id: string }[]
      }

      if (inv.status === 'cancelled') {
        throw new Error('La factura ya está cancelada')
      }
      if (Number(inv.paid_amount) > 0) {
        throw new Error(
          'No se puede cancelar una factura con pagos registrados',
        )
      }
      if ((inv.purchase_invoice_items ?? []).length > 0) {
        throw new Error(
          'No se puede cancelar una factura con ítems registrados. Para revertir, haz un ajuste manual de inventario.',
        )
      }

      const reason = input.reason.trim()
      const newNotes = reason
        ? inv.notes
          ? `${inv.notes} · Cancelada: ${reason}`
          : `Cancelada: ${reason}`
        : inv.notes

      const { error } = await supabase
        .from('purchase_invoices')
        .update({ status: 'cancelled', notes: newNotes } as never)
        .eq('id' as never, input.id)
      if (error) throw new Error(`No se pudo cancelar: ${error.message}`)
    },
    onSuccess: (_data, input) => {
      invalidateInvoiceWriteQueries(queryClient)
      void queryClient.invalidateQueries({
        queryKey: ['purchase-invoices', 'detail', input.id],
      })
      toast.success('Factura cancelada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
