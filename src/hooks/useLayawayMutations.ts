import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { fmtCOP } from '@/lib/formatters'
import type {
  Layaway,
  Order,
  PaymentMethod,
} from '@/types/database.types'

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface NewLayawayItem {
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
}

export interface CreateLayawayInput {
  customer_id: string
  items: NewLayawayItem[]
  expires_at: string // ISO
  discount?: number
  max_discount?: number
  initial_payment?: {
    amount: number
    method: PaymentMethod
    notes?: string
  }
  notes?: string
}

export interface AddPaymentInput {
  layaway_id: string
  amount: number
  method: PaymentMethod
  notes?: string
}

export interface CancelLayawayInput {
  id: string
  cancellation_reason: string
}

export interface CompleteLayawayInput {
  id: string
  final_payment?: {
    amount: number
    method: PaymentMethod
    notes?: string
  }
}

// ── Helpers de invalidación ───────────────────────────────────────────────────

function invalidateLayawayWriteQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: ['layaways'] })
  void queryClient.invalidateQueries({ queryKey: ['active-layaways-count'] })
  void queryClient.invalidateQueries({ queryKey: ['variants'] })
  void queryClient.invalidateQueries({ queryKey: ['products'] })
  void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
  void queryClient.invalidateQueries({ queryKey: ['customers'] })
}

// ── useCreateLayaway ──────────────────────────────────────────────────────────

export function useCreateLayaway() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateLayawayInput): Promise<Layaway> => {
      const storeId = profile?.store_id
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (!input.customer_id) {
        throw new Error('Selecciona un cliente para el separado')
      }
      if (!input.items.length) {
        throw new Error('Agrega al menos un artículo al separado')
      }
      for (const it of input.items) {
        if (!it.variant_id || !it.product_id) {
          throw new Error('Ítem inválido en el separado')
        }
        if (it.qty <= 0) {
          throw new Error('La cantidad debe ser mayor a cero')
        }
        if (it.unit_price < 0) {
          throw new Error('El precio no puede ser negativo')
        }
      }
      const subtotal = input.items.reduce(
        (s, it) => s + it.qty * it.unit_price,
        0,
      )
      if (subtotal <= 0) {
        throw new Error('El total del separado debe ser mayor a cero')
      }

      const rawDiscount = input.discount ?? 0
      if (rawDiscount < 0) {
        throw new Error('El descuento no puede ser negativo')
      }
      if (rawDiscount > subtotal) {
        throw new Error('El descuento no puede superar el subtotal')
      }
      if (typeof input.max_discount === 'number' && rawDiscount > input.max_discount) {
        throw new Error(
          `Descuento máximo permitido: ${fmtCOP(input.max_discount)}`,
        )
      }
      const discount = Math.round(rawDiscount)
      const total = subtotal - discount
      if (total <= 0) {
        throw new Error('El total con descuento debe ser mayor a cero')
      }

      // Pre-check de stock disponible (defensa en profundidad; el trigger
      // valida de nuevo dentro del INSERT).
      const variantIds = [...new Set(input.items.map((i) => i.variant_id))]
      const { data: variantRows, error: variantErr } = await supabase
        .from('variants')
        .select('id, stock_qty, reserved_qty')
        .in('id' as never, variantIds)
        .eq('store_id' as never, storeId)
      if (variantErr) throw variantErr

      const stockMap = new Map<string, { stock: number; reserved: number }>()
      for (const v of (variantRows ?? []) as unknown as Array<{
        id: string
        stock_qty: number
        reserved_qty: number
      }>) {
        stockMap.set(v.id, { stock: v.stock_qty, reserved: v.reserved_qty })
      }
      const requested = new Map<string, number>()
      for (const it of input.items) {
        requested.set(it.variant_id, (requested.get(it.variant_id) ?? 0) + it.qty)
      }
      for (const [vid, qty] of requested) {
        const s = stockMap.get(vid)
        if (!s) {
          throw new Error('Una variante seleccionada ya no está disponible')
        }
        const available = s.stock - s.reserved
        if (available < qty) {
          throw new Error(
            `Stock insuficiente: disponibles ${available}, requeridos ${qty}`,
          )
        }
      }

      // Validar abono inicial
      if (input.initial_payment) {
        if (input.initial_payment.amount <= 0) {
          throw new Error('El abono inicial debe ser mayor a cero')
        }
        if (input.initial_payment.amount > total) {
          throw new Error('El abono inicial no puede superar el total')
        }
      }

      // INSERT layaways
      const { data: layawayRow, error: layawayErr } = await supabase
        .from('layaways')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          created_by: userId,
          subtotal,
          discount,
          total,
          expires_at: input.expires_at,
          notes: input.notes?.trim() ? input.notes.trim() : null,
        } as never)
        .select()
        .single()

      if (layawayErr || !layawayRow) {
        throw new Error(
          `No se pudo crear el separado: ${layawayErr?.message ?? 'desconocido'}`,
        )
      }
      const layaway = layawayRow as unknown as Layaway

      // INSERT items (triggers reservan stock; si falla, rollback)
      const { error: itemsErr } = await supabase.from('layaway_items').insert(
        input.items.map((it) => ({
          layaway_id: layaway.id,
          variant_id: it.variant_id,
          product_id: it.product_id,
          qty: it.qty,
          unit_price: it.unit_price,
        })) as never,
      )

      if (itemsErr) {
        const { error: rollbackErr } = await supabase
          .from('layaways')
          .delete()
          .eq('id' as never, layaway.id)
        if (rollbackErr) {
          console.error('[useCreateLayaway] rollback falló', rollbackErr)
        }
        throw new Error(`No se pudo reservar el stock: ${itemsErr.message}`)
      }

      // INSERT abono inicial (opcional)
      if (input.initial_payment) {
        const { error: payErr } = await supabase
          .from('layaway_payments')
          .insert({
            layaway_id: layaway.id,
            store_id: storeId,
            amount: input.initial_payment.amount,
            payment_method: input.initial_payment.method,
            created_by: userId,
            notes: input.initial_payment.notes?.trim()
              ? input.initial_payment.notes.trim()
              : null,
          } as never)
        if (payErr) {
          // No revertimos la reserva: el separado se creó OK, solo el abono
          // falló. Mostramos un error claro y el operador puede registrar
          // el abono manualmente desde el detalle.
          toast.error(
            `Separado creado, pero el abono no se registró: ${payErr.message}`,
          )
        }
      }

      return layaway
    },
    onSuccess: (layaway) => {
      invalidateLayawayWriteQueries(queryClient)
      toast.success(`Separado #${layaway.layaway_number} creado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useAddLayawayPayment ──────────────────────────────────────────────────────

export function useAddLayawayPayment() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddPaymentInput) => {
      const storeId = profile?.store_id
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (input.amount <= 0) {
        throw new Error('El abono debe ser mayor a cero')
      }

      // Validar saldo
      const { data: laRaw, error: laErr } = await supabase
        .from('layaways')
        .select('total, paid_amount, status')
        .eq('id' as never, input.layaway_id)
        .eq('store_id' as never, storeId)
        .single()
      if (laErr || !laRaw) throw new Error('Separado no encontrado')

      const la = laRaw as unknown as {
        total: number
        paid_amount: number
        status: string
      }
      if (la.status !== 'active') {
        throw new Error('Solo se pueden registrar abonos en separados activos')
      }
      const remaining = Number(la.total) - Number(la.paid_amount)
      if (input.amount > remaining) {
        throw new Error(`El abono no puede superar el saldo (${fmtCOP(remaining)})`)
      }

      const { error: payErr } = await supabase
        .from('layaway_payments')
        .insert({
          layaway_id: input.layaway_id,
          store_id: storeId,
          amount: input.amount,
          payment_method: input.method,
          created_by: userId,
          notes: input.notes?.trim() ? input.notes.trim() : null,
        } as never)
      if (payErr) {
        throw new Error(`No se pudo registrar el abono: ${payErr.message}`)
      }
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['layaways'] })
      void queryClient.invalidateQueries({
        queryKey: ['layaways', 'detail', input.layaway_id],
      })
      toast.success(`Abono ${fmtCOP(input.amount)} registrado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useCancelLayaway ──────────────────────────────────────────────────────────

export function useCancelLayaway() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CancelLayawayInput) => {
      const storeId = profile?.store_id
      if (!storeId) throw new Error('Sesión inválida')
      const reason = input.cancellation_reason.trim()
      if (reason.length < 5) {
        throw new Error('Indica un motivo de cancelación (mínimo 5 caracteres)')
      }

      const { data: laRaw, error: laErr } = await supabase
        .from('layaways')
        .select('status, paid_amount')
        .eq('id' as never, input.id)
        .eq('store_id' as never, storeId)
        .single()
      if (laErr || !laRaw) throw new Error('Separado no encontrado')
      const la = laRaw as unknown as { status: string; paid_amount: number }
      if (la.status !== 'active') {
        throw new Error('Solo se pueden cancelar separados activos')
      }

      const { error } = await supabase
        .from('layaways')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
        } as never)
        .eq('id' as never, input.id)
      if (error) throw new Error(`No se pudo cancelar: ${error.message}`)
      return { paid_amount: Number(la.paid_amount) }
    },
    onSuccess: (data) => {
      invalidateLayawayWriteQueries(queryClient)
      toast.success('Separado cancelado. Stock liberado.')
      if (data.paid_amount > 0) {
        toast(
          `Recuerda: los abonos (${fmtCOP(data.paid_amount)}) no se reembolsan automáticamente`,
          { duration: 6000, icon: 'ℹ️' },
        )
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useCompleteLayaway ────────────────────────────────────────────────────────

export interface CompletedLayawayResult {
  layaway: Layaway
  order: Order
}

export function useCompleteLayaway() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: CompleteLayawayInput,
    ): Promise<CompletedLayawayResult> => {
      const storeId = profile?.store_id
      const userId = profile?.id
      if (!storeId || !userId) throw new Error('Sesión inválida')

      // 1. Cargar separado + items + pagos
      const { data: laRaw, error: laErr } = await supabase
        .from('layaways')
        .select(
          `*,
           layaway_items(id, variant_id, product_id, qty, unit_price),
           layaway_payments(id, amount, payment_method, created_at)`,
        )
        .eq('id' as never, input.id)
        .eq('store_id' as never, storeId)
        .single()
      if (laErr || !laRaw) throw new Error('Separado no encontrado')

      const la = laRaw as unknown as Layaway & {
        layaway_items: Array<{
          id: string
          variant_id: string
          product_id: string
          qty: number
          unit_price: number
        }>
        layaway_payments: Array<{
          id: string
          amount: number
          payment_method: PaymentMethod
          created_at: string
        }>
      }

      if (la.status !== 'active') {
        throw new Error('Solo se pueden completar separados activos')
      }
      if (!la.layaway_items.length) {
        throw new Error('El separado no tiene ítems')
      }

      // 2. Si hay pago final, validar e insertar
      const remainingBefore = Number(la.total) - Number(la.paid_amount)
      if (input.final_payment) {
        if (input.final_payment.amount <= 0) {
          throw new Error('El pago final debe ser mayor a cero')
        }
        if (input.final_payment.amount > remainingBefore) {
          throw new Error(
            `El pago final no puede superar el saldo (${fmtCOP(remainingBefore)})`,
          )
        }
        const { error: payErr } = await supabase
          .from('layaway_payments')
          .insert({
            layaway_id: la.id,
            store_id: storeId,
            amount: input.final_payment.amount,
            payment_method: input.final_payment.method,
            created_by: userId,
            notes: input.final_payment.notes?.trim()
              ? input.final_payment.notes.trim()
              : null,
          } as never)
        if (payErr) {
          throw new Error(`No se pudo registrar el pago final: ${payErr.message}`)
        }
      }

      // 3. Verificar saldo (recargar paid_amount actualizado por trigger)
      const { data: laPaidRaw, error: paidErr } = await supabase
        .from('layaways')
        .select('paid_amount')
        .eq('id' as never, la.id)
        .single()
      if (paidErr || !laPaidRaw) {
        throw new Error('No se pudo verificar el saldo actualizado')
      }
      const paidNow = Number(
        (laPaidRaw as unknown as { paid_amount: number }).paid_amount,
      )
      if (paidNow + 0.5 < Number(la.total)) {
        throw new Error('Falta saldo por pagar antes de completar el separado')
      }

      // 4. Determinar método de pago de la orden
      const sortedPayments = la.layaway_payments
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      const lastMethod =
        input.final_payment?.method ??
        sortedPayments[0]?.payment_method ??
        ('cash' as PaymentMethod)

      // 5. INSERT orden
      const orderSubtotal = Number(la.subtotal ?? la.total)
      const orderDiscount = Number(la.discount ?? 0)
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          customer_id: la.customer_id,
          created_by: userId,
          status: 'completed',
          subtotal: orderSubtotal,
          discount: orderDiscount,
          total: la.total,
          payment_method: lastMethod,
          cash_received: null,
        } as never)
        .select()
        .single()

      if (orderErr || !orderRow) {
        throw new Error(
          `No se pudo crear la orden: ${orderErr?.message ?? 'desconocido'}`,
        )
      }
      const order = orderRow as unknown as Order

      // 6. INSERT order_items (trigger deduce stock real)
      const { error: oiErr } = await supabase.from('order_items').insert(
        la.layaway_items.map((it) => ({
          order_id: order.id,
          variant_id: it.variant_id,
          product_id: it.product_id,
          qty: it.qty,
          unit_price: it.unit_price,
        })) as never,
      )
      if (oiErr) {
        const { error: rollbackErr } = await supabase
          .from('orders')
          .delete()
          .eq('id' as never, order.id)
        if (rollbackErr) {
          console.error('[useCompleteLayaway] rollback de orden falló', rollbackErr)
        }
        throw new Error(`No se pudo crear la venta: ${oiErr.message}`)
      }

      // 7. UPDATE layaway → completed (trigger libera reserved_qty)
      const { error: updErr } = await supabase
        .from('layaways')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          converted_order_id: order.id,
        } as never)
        .eq('id' as never, la.id)
      if (updErr) {
        console.error(
          '[useCompleteLayaway] FALLA CRÍTICA: orden creada pero layaway no marcado como completed',
          { orderId: order.id, layawayId: la.id, error: updErr },
        )
        throw new Error(
          `Venta creada (orden #${order.order_number}) pero el separado quedó en estado inconsistente. Contacta a soporte.`,
        )
      }

      return { layaway: la as Layaway, order }
    },
    onSuccess: ({ order }) => {
      invalidateLayawayWriteQueries(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      toast.success(`Separado completado · Venta #${order.order_number}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useExpireOverdueLayaways ──────────────────────────────────────────────────

export function useExpireOverdueLayaways() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc(
        'expire_overdue_layaways' as never,
      )
      if (error) throw error
      return (data as unknown as number) ?? 0
    },
    onSuccess: (count) => {
      if (count > 0) {
        invalidateLayawayWriteQueries(queryClient)
      }
    },
    onError: (err: Error) => {
      console.error('[useExpireOverdueLayaways]', err)
    },
  })
}
