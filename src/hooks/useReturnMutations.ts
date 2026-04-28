import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'
import type { PaymentMethod, ReturnType, Return } from '@/types/database.types'

// ── Input types ───────────────────────────────────────────────────────────────

export type ReturnItemInput = {
  variant_id: string
  qty: number
  unit_price: number
}

export type ExchangeItemInput = {
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
}

export type CreateReturnInput = {
  original_order_id: string
  customer_id: string | null
  type: ReturnType
  returnItems: ReturnItemInput[]
  exchangeItems: ExchangeItemInput[] // solo cuando type === 'exchange'
  refundMethod: PaymentMethod
  notes: string
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function useCreateReturn() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateReturnInput): Promise<Return> => {
      const storeId = profile?.store_id ?? ''
      const userId = profile?.id ?? ''

      // Paso 1 — verificar stock de variantes nuevas antes de comprometerse
      if (input.type === 'exchange' && input.exchangeItems.length > 0) {
        for (const item of input.exchangeItems) {
          const { data: variant, error } = await supabase
            .from('variants')
            .select('stock_qty, products(name), size, color')
            .eq('id' as never, item.variant_id)
            .single()

          if (error) throw error

          type RawVariant = {
            stock_qty: number
            products: { name: string } | null
            size: string | null
            color: string | null
          }
          const v = variant as unknown as RawVariant

          if (v.stock_qty < item.qty) {
            const label = [v.products?.name, v.size, v.color].filter(Boolean).join(' ')
            throw new Error(`Stock insuficiente para ${label} (disponible: ${v.stock_qty})`)
          }
        }
      }

      // Paso 2 — INSERT returns
      const { data: returnRecord, error: returnErr } = await supabase
        .from('returns')
        .insert({
          original_order_id: input.original_order_id,
          store_id: storeId,
          created_by: userId,
          type: input.type,
          status: 'completed',
          notes: input.notes || null,
        } as never)
        .select()
        .single()

      if (returnErr) throw returnErr
      const ret = returnRecord as Return

      // Paso 3 — INSERT return_items (el trigger restaura el stock automáticamente)
      const { error: itemsErr } = await supabase.from('return_items').insert(
        input.returnItems.map((ri) => ({
          return_id: ret.id,
          variant_id: ri.variant_id,
          qty: ri.qty,
          unit_price: ri.unit_price,
          action: input.type === 'return' ? 'refund' : 'exchange',
        })) as never,
      )
      if (itemsErr) throw itemsErr

      // Paso 4 — Si es cambio: crear nueva orden con los ítems de cambio
      if (input.type === 'exchange' && input.exchangeItems.length > 0) {
        const exchangeTotal = input.exchangeItems.reduce(
          (sum, i) => sum + i.unit_price * i.qty,
          0,
        )

        const { data: newOrder, error: orderErr } = await supabase
          .from('orders')
          .insert({
            store_id: storeId,
            customer_id: input.customer_id,
            created_by: userId,
            status: 'completed',
            subtotal: exchangeTotal,
            discount: 0,
            total: exchangeTotal,
            payment_method: input.refundMethod,
            cash_received: null,
          } as never)
          .select()
          .single()

        if (orderErr) throw orderErr
        const order = newOrder as { id: string }

        const { error: exchItemsErr } = await supabase.from('order_items').insert(
          input.exchangeItems.map((i) => ({
            order_id: order.id,
            variant_id: i.variant_id,
            product_id: i.product_id,
            qty: i.qty,
            unit_price: i.unit_price,
          })) as never,
        )
        if (exchItemsErr) throw exchItemsErr
      }

      return ret
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['returns'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      toast.success('Devolución registrada exitosamente')
    },

    onError: (err: Error) => toast.error(err.message),
  })
}
