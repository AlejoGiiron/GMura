import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useCurrentShift } from './useCashShift'
import { useResolvedConfig } from './useConfig'
import { usePermissions } from './usePermissions'
import { fmtCOP } from '@/lib/formatters'
import { orderTotals, minFinalPrice } from '@/stores/cartStore'
import type { CartItem } from '@/stores/cartStore'
import { isValidGiftReason } from '@/lib/giftReasons'
import {
  creditBalance,
  resolveCreditPaymentImputation,
} from '@/lib/creditCalc'
import {
  assertValidAbono,
  assertValidSplitLines,
  sumPaymentLines,
  type PaymentLine,
} from '@/lib/orderPayments'
import { assertShiftForPayment } from '@/lib/shiftGuard'
import type { Order } from '@/types/database.types'

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface CreateCreditOrderInput {
  items: CartItem[]
  // OBLIGATORIO en un fiado: no se fía a un cliente anónimo.
  customer_id: string
  surcharge?: number
  // Abono inicial opcional (puede ser $0 = fiado puro sin pago hoy → se omite).
  // Puede ser MIXTO (N líneas). Se registra como credit_payment(s) (NO como
  // cash_received) para que entre al cuadre por su canal; la orden 'credit' se
  // excluye del efectivo.
  initial_payment?: {
    payments: PaymentLine[]
    notes?: string
  }
}

export interface AddCreditPaymentInput {
  order_id: string
  // Un abono de fiado puede pagarse con VARIOS métodos (pagos mixtos). Una fila
  // por método en credit_payments; el abono total = Σ payments.
  payments: PaymentLine[]
  notes?: string
}

// ── Helpers de invalidación ───────────────────────────────────────────────────

function invalidateCreditWriteQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: ['orders'] })
  void queryClient.invalidateQueries({ queryKey: ['sales-history'] })
  void queryClient.invalidateQueries({ queryKey: ['credit-balance'] })
  void queryClient.invalidateQueries({ queryKey: ['credit'] })
  void queryClient.invalidateQueries({ queryKey: ['variants'] })
  void queryClient.invalidateQueries({ queryKey: ['products'] })
  void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
  void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
  void queryClient.invalidateQueries({ queryKey: ['customers'] })
  void queryClient.invalidateQueries({ queryKey: ['cash-shift'] })
  void queryClient.invalidateQueries({ queryKey: ['shift-closing'] })
  void queryClient.invalidateQueries({ queryKey: ['shift-expenses'] })
}

// ── useCreateCreditOrder ────────────────────────────────────────────────────────
// Crea una venta FIADA: orden is_credit=true + order_items (descuenta stock) +
// abono inicial opcional como credit_payment. Gateado por ventas.fiar (cliente +
// RLS server-side: orders_insert exige el permiso para is_credit=true).

export function useCreateCreditOrder() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: currentShift } = useCurrentShift()
  const { can } = usePermissions()
  const maxItemDiscount = useResolvedConfig().max_item_discount

  return useMutation({
    mutationFn: async (input: CreateCreditOrderInput): Promise<Order> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      // Gate de cliente (defensa en profundidad; el server lo exige por RLS).
      if (!can('ventas.fiar')) {
        throw new Error('No tienes permiso para vender a crédito (fiar).')
      }
      if (!input.customer_id) {
        throw new Error('Un fiado requiere un cliente (no se fía a anónimo).')
      }
      if (input.items.length === 0) {
        throw new Error('El carrito está vacío')
      }

      // Validación de ítems — mismo criterio que useCreateOrder.
      for (const item of input.items) {
        if (!item.variant_id || !item.product_id) {
          throw new Error('Ítem inválido en el carrito (falta variante o producto)')
        }
        if (item.qty <= 0) {
          throw new Error(`Cantidad inválida para ${item.name}`)
        }
        if (item.unit_price < 0 || item.list_price < 0) {
          throw new Error(`Precio inválido para ${item.name}`)
        }
        if (item.unit_price > item.list_price) {
          throw new Error(
            `Precio inválido para ${item.name}: el precio final (${fmtCOP(
              item.unit_price,
            )}) no puede superar el de catálogo (${fmtCOP(item.list_price)}).`,
          )
        }
        if (item.isGift) {
          if (!isValidGiftReason(item.giftReason)) {
            throw new Error(`Regalo sin motivo válido para ${item.name}.`)
          }
          if (item.unit_price !== 0) {
            throw new Error(`Un ítem de regalo debe tener precio 0 (${item.name}).`)
          }
        } else {
          const minFinal = minFinalPrice(item.list_price, maxItemDiscount)
          if (item.unit_price < minFinal) {
            throw new Error(
              `Descuento no permitido para ${item.name}: el precio mínimo es ${fmtCOP(
                minFinal,
              )}.`,
            )
          }
        }
      }

      const { subtotal, discount, surcharge, total } = orderTotals(
        input.items,
        input.surcharge,
      )
      if (total <= 0) {
        throw new Error('El total del fiado debe ser mayor a cero')
      }

      // Validar abono inicial (si lo hay; puede ser mixto): ≥1 línea, método
      // válido, monto>0, sin repetir, y Σ <= total (lo demás queda debiendo).
      if (input.initial_payment) {
        assertValidSplitLines(input.initial_payment.payments)
        if (sumPaymentLines(input.initial_payment.payments) > total + 0.5) {
          throw new Error('El abono inicial no puede superar el total del fiado.')
        }
      }

      // INSERT orden fiada (is_credit=true, método 'credit', paid_amount default 0)
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          created_by: userId,
          status: 'completed',
          subtotal,
          discount,
          surcharge,
          total,
          payment_method: 'credit',
          is_credit: true,
          cash_received: null,
          shift_id: currentShift?.id ?? null,
        } as never)
        .select()
        .single()

      if (orderErr || !orderRow) {
        throw new Error(
          `No se pudo crear el fiado: ${orderErr?.message ?? 'desconocido'}`,
        )
      }
      const order = orderRow as unknown as Order

      // INSERT order_items (trigger descuenta stock). Rollback si falla.
      const { error: itemsErr } = await supabase.from('order_items').insert(
        input.items.map((item) => ({
          order_id: order.id,
          variant_id: item.variant_id,
          product_id: item.product_id,
          qty: item.qty,
          unit_price: item.unit_price,
          list_price: item.list_price,
          is_gift: item.isGift,
          gift_reason: item.isGift ? item.giftReason : null,
        })) as never,
      )
      if (itemsErr) {
        const { error: rollbackErr } = await supabase
          .from('orders')
          .delete()
          .eq('id' as never, order.id)
        if (rollbackErr) {
          console.error('[useCreateCreditOrder] rollback de orden falló', rollbackErr)
        }
        throw new Error(`Error al guardar el fiado: ${itemsErr.message}`)
      }

      // INSERT abono inicial (si lo hay) como credit_payment(s). Puede ser MIXTO
      // → N filas con la misma imputación y momento. Best-effort: si falla, el
      // fiado ya se creó OK; se puede registrar el abono desde el detalle.
      if (input.initial_payment) {
        const imputation = resolveCreditPaymentImputation(currentShift?.id)
        const initNotes = input.initial_payment.notes?.trim()
          ? input.initial_payment.notes.trim()
          : null
        const rows = input.initial_payment.payments.map((p, idx) => ({
          order_id: order.id,
          store_id: storeId,
          amount: p.amount,
          payment_method: p.method,
          created_by: userId,
          shift_id: imputation.shift_id,
          is_historical: imputation.is_historical,
          notes: idx === 0 ? initNotes : null,
        }))
        const { error: payErr } = await supabase
          .from('credit_payments')
          .insert(rows as never)
        if (payErr) {
          toast.error(
            `Fiado creado, pero el abono inicial no se registró: ${payErr.message}`,
          )
        }
      }

      return order
    },
    onSuccess: (order) => {
      invalidateCreditWriteQueries(queryClient)
      toast.success(`Fiado #${order.order_number} creado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useAddCreditPayment ─────────────────────────────────────────────────────────
// Registra un abono posterior contra un fiado. Calco de useAddLayawayPayment:
// valida el saldo, imputa al turno; el trigger sube orders.paid_amount.

export function useAddCreditPayment() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: currentShift } = useCurrentShift()

  return useMutation({
    mutationFn: async (input: AddCreditPaymentInput) => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      // Guard de turno: el abono de cartera ENTRA a la caja ahora → exige turno.
      // Los abonos de fiado creados por la app son siempre efectivo real de ahora
      // (resolveCreditPaymentImputation nunca marca is_historical), así que el
      // guard aplica sin excepción por esta vía.
      assertShiftForPayment(currentShift?.id)

      // Cargar el fiado y validar estado + saldo.
      const { data: oRaw, error: oErr } = await supabase
        .from('orders')
        .select('total, paid_amount, is_credit, status')
        .eq('id' as never, input.order_id)
        .eq('store_id' as never, storeId)
        .single()
      if (oErr || !oRaw) throw new Error('Fiado no encontrado')

      const o = oRaw as unknown as {
        total: number
        paid_amount: number
        is_credit: boolean
        status: string
      }
      if (!o.is_credit) {
        throw new Error('Esta venta no es un fiado')
      }
      if (o.status !== 'completed') {
        throw new Error('Solo se pueden abonar fiados activos')
      }

      const saldo = creditBalance(Number(o.total), Number(o.paid_amount))
      // Valida ≥1 línea, método válido, monto>0, sin repetir y Σ <= saldo.
      assertValidAbono(input.payments, saldo)

      const imputation = resolveCreditPaymentImputation(currentShift?.id)
      const notes = input.notes?.trim() ? input.notes.trim() : null
      // Abono mixto = N filas con la MISMA imputación (shift_id/is_historical) y
      // momento. El trigger update_order_paid_amount suma cada fila al saldo.
      const rows = input.payments.map((p, idx) => ({
        order_id: input.order_id,
        store_id: storeId,
        amount: p.amount,
        payment_method: p.method,
        created_by: userId,
        shift_id: imputation.shift_id,
        is_historical: imputation.is_historical,
        notes: idx === 0 ? notes : null,
      }))
      const { error: payErr } = await supabase
        .from('credit_payments')
        .insert(rows as never)
      if (payErr) {
        throw new Error(`No se pudo registrar el abono: ${payErr.message}`)
      }
    },
    onSuccess: (_data, input) => {
      invalidateCreditWriteQueries(queryClient)
      void queryClient.invalidateQueries({
        queryKey: ['credit', 'detail', input.order_id],
      })
      toast.success(`Abono ${fmtCOP(sumPaymentLines(input.payments))} registrado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
