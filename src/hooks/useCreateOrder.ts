import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'
import type { Order, PaymentMethod } from '@/types/database.types'
import { cartTotals } from '@/stores/cartStore'
import type { CartItem, Discount } from '@/stores/cartStore'

export interface CreateOrderInput {
  items: CartItem[]
  discount: Discount
  customer_id: string | null
  payment_method: PaymentMethod
  cash_received?: number
}

export function useCreateOrder() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateOrderInput): Promise<Order> => {
      const { subtotal, discountAmt, total } = cartTotals(input.items, input.discount)
      const storeId = profile?.store_id ?? ''
      const userId = profile?.id ?? ''

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          created_by: userId,
          status: 'completed',
          subtotal,
          discount: discountAmt,
          total,
          payment_method: input.payment_method,
          cash_received: input.cash_received ?? null,
        } as never)
        .select()
        .single()
      if (orderError) throw orderError

      const o = order as Order

      const { error: itemsError } = await supabase.from('order_items').insert(
        input.items.map((item) => ({
          order_id: o.id,
          variant_id: item.variant_id,
          product_id: item.product_id,
          qty: item.qty,
          unit_price: item.unit_price,
        })) as never,
      )
      if (itemsError) throw itemsError

      return o
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
