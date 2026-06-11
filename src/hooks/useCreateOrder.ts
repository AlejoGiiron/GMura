import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
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
  // Recargo manual (ej. Addi). Se suma al total. Default 0.
  surcharge?: number
}

export function useCreateOrder() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateOrderInput): Promise<Order> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id

      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }

      if (input.items.length === 0) {
        throw new Error('El carrito está vacío')
      }
      for (const item of input.items) {
        if (!item.variant_id || !item.product_id) {
          throw new Error('Ítem inválido en el carrito (falta variante o producto)')
        }
        if (item.qty <= 0) {
          throw new Error(`Cantidad inválida para ${item.name}`)
        }
        if (item.unit_price < 0) {
          throw new Error(`Precio inválido para ${item.name}`)
        }
      }

      const { subtotal, discountAmt } = cartTotals(input.items, input.discount)
      // Recargo manual (ej. Addi). Se suma al total; nunca negativo.
      const surcharge = Math.max(0, input.surcharge ?? 0)
      const total = subtotal - discountAmt + surcharge
      if (total < 0) {
        throw new Error('El total no puede ser negativo')
      }

      console.info('[useCreateOrder] Creando orden…', {
        items: input.items.length,
        total,
        surcharge,
        payment_method: input.payment_method,
      })

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          created_by: userId,
          status: 'completed',
          subtotal,
          discount: discountAmt,
          surcharge,
          total,
          payment_method: input.payment_method,
          cash_received: input.cash_received ?? null,
        } as never)
        .select()
        .single()

      if (orderError || !order) {
        console.error('[useCreateOrder] Error insertando orden:', orderError)
        throw new Error(
          `Error al guardar venta: ${orderError?.message ?? 'desconocido'}`,
        )
      }

      const o = order as Order
      console.info(
        `[useCreateOrder] Orden creada con id ${o.id}, insertando ${input.items.length} ítems…`,
      )

      const { error: itemsError } = await supabase.from('order_items').insert(
        input.items.map((item) => ({
          order_id: o.id,
          variant_id: item.variant_id,
          product_id: item.product_id,
          qty: item.qty,
          unit_price: item.unit_price,
        })) as never,
      )

      if (itemsError) {
        console.error(
          '[useCreateOrder] Error insertando ítems, ejecutando rollback…',
          itemsError,
        )
        const { error: rollbackError } = await supabase
          .from('orders')
          .delete()
          .eq('id' as never, o.id)
        if (rollbackError) {
          console.error(
            '[useCreateOrder] Rollback de orden falló:',
            rollbackError,
          )
        }
        throw new Error(`Error al guardar venta: ${itemsError.message}`)
      }

      console.info('[useCreateOrder] Ítems insertados correctamente')
      return o
    },

    onSuccess: (order) => {
      console.info('✅ Orden creada:', order.id)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['cash-shift'] })
    },

    onError: (err: Error) => {
      console.error('[useCreateOrder] Mutación falló:', err)
      toast.error(err.message)
    },
  })
}
