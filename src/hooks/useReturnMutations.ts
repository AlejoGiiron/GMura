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

// Agrupa cantidades por variant_id para que el chequeo de stock contemple
// duplicados (ej: dos líneas de exchange apuntando a la misma variante).
function aggregateQtyByVariant(items: { variant_id: string; qty: number }[]) {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item.variant_id, (map.get(item.variant_id) ?? 0) + item.qty)
  }
  return map
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function useCreateReturn() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateReturnInput): Promise<Return> => {
      const storeId = profile?.store_id
      const userId = profile?.id

      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }

      // Validación de inputs antes de tocar BD
      if (input.returnItems.length === 0) {
        throw new Error('Debes seleccionar al menos un ítem para devolver')
      }
      if (input.returnItems.some((r) => r.qty <= 0)) {
        throw new Error('La cantidad a devolver debe ser mayor a 0')
      }
      if (input.type === 'exchange' && input.exchangeItems.length === 0) {
        throw new Error('Debes seleccionar al menos una variante de cambio')
      }
      if (input.type === 'exchange' && input.exchangeItems.some((e) => e.qty <= 0)) {
        throw new Error('La cantidad de cambio debe ser mayor a 0')
      }

      // Paso 1 — Verificar stock de variantes nuevas (agrupando duplicados)
      if (input.type === 'exchange') {
        const required = aggregateQtyByVariant(input.exchangeItems)

        for (const [variantId, qtyRequired] of required) {
          const { data: variant, error } = await supabase
            .from('variants')
            .select('stock_qty, products(name), size, color')
            .eq('id' as never, variantId)
            .eq('store_id' as never, storeId)
            .single()

          if (error || !variant) {
            throw new Error(
              'Variante de cambio no encontrada o no pertenece a esta tienda',
            )
          }

          type RawVariant = {
            stock_qty: number
            products: { name: string } | null
            size: string | null
            color: string | null
          }
          const v = variant as unknown as RawVariant

          if (v.stock_qty < qtyRequired) {
            const label = [v.products?.name, v.size, v.color]
              .filter(Boolean)
              .join(' ')
            throw new Error(
              `Sin stock disponible para ${label} (requeridas: ${qtyRequired}, disponible: ${v.stock_qty})`,
            )
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
          notes: input.notes.trim() || null,
        } as never)
        .select()
        .single()

      if (returnErr || !returnRecord) {
        throw new Error(
          returnErr?.message ?? 'No se pudo registrar la devolución',
        )
      }
      const ret = returnRecord as Return

      // Paso 3 — INSERT return_items (el trigger repone stock automáticamente)
      const { error: itemsErr } = await supabase.from('return_items').insert(
        input.returnItems.map((ri) => ({
          return_id: ret.id,
          variant_id: ri.variant_id,
          qty: ri.qty,
          unit_price: ri.unit_price,
          action: input.type === 'return' ? 'refund' : 'exchange',
        })) as never,
      )

      if (itemsErr) {
        // Rollback manual: la fila returns quedó huérfana. ON DELETE CASCADE
        // limpia los return_items (en caso de que alguno sí entró).
        await supabase.from('returns').delete().eq('id' as never, ret.id)
        throw new Error(
          `No se pudieron registrar los ítems devueltos: ${itemsErr.message}`,
        )
      }

      // Paso 4 — Si es cambio: crear nueva orden con los ítems nuevos.
      // El trigger deduct_stock_on_sale descuenta stock automáticamente.
      if (input.type === 'exchange') {
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

        if (orderErr || !newOrder) {
          // La devolución ya está confirmada; no podemos revertirla sin RPC.
          // Avisamos al usuario para que cree la venta manualmente.
          throw new Error(
            `Devolución registrada pero falló crear la orden de cambio: ${
              orderErr?.message ?? 'desconocido'
            }. Crea la venta manualmente.`,
          )
        }

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

        if (exchItemsErr) {
          // La orden quedó huérfana sin ítems (y sin descontar stock).
          // ON DELETE CASCADE limpia order_items si alguno entró.
          await supabase.from('orders').delete().eq('id' as never, order.id)
          throw new Error(
            `Devolución registrada pero falló agregar los ítems de cambio: ${exchItemsErr.message}. Crea la venta manualmente.`,
          )
        }
      }

      return ret
    },

    onSuccess: () => {
      // Invalidar todo lo que muestre stock o devoluciones.
      // React Query hace match por prefijo, así que ['returns'] cubre
      // ['returns', 'history'], ['returns', 'order-detail'], etc.
      void queryClient.invalidateQueries({ queryKey: ['returns'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Devolución registrada exitosamente')
    },

    onError: (err: Error) => toast.error(err.message),
  })
}
