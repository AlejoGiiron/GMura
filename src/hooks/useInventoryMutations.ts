import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { StockMovementType } from '@/types/database.types'

type AdjustStockInput = {
  variantId: string
  qty: number
  type: StockMovementType
  notes: string
}

export function useInventoryMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }

  const adjustStock = useMutation({
    mutationFn: async ({ variantId, qty, type, notes }: AdjustStockInput) => {
      // Fetch current stock to compute new value
      const { data: variant, error: fetchErr } = await supabase
        .from('variants')
        .select('stock_qty')
        .eq('id' as never, variantId)
        .eq('store_id' as never, storeId)
        .single()

      if (fetchErr) throw fetchErr

      const currentQty = (variant as { stock_qty: number }).stock_qty
      const newQty = currentQty + qty

      if (newQty < 0) {
        throw new Error(`Stock insuficiente. Actual: ${currentQty}, ajuste: ${qty}`)
      }

      // Update stock
      const { error: updateErr } = await supabase
        .from('variants')
        .update({ stock_qty: newQty } as never)
        .eq('id' as never, variantId)
        .eq('store_id' as never, storeId)

      if (updateErr) throw updateErr

      // Insert immutable movement record
      const { error: movErr } = await supabase
        .from('stock_movements')
        .insert({
          variant_id: variantId,
          store_id: storeId,
          type,
          qty,
          notes,
          created_by: profile!.id,
        } as never)

      if (movErr) throw movErr
    },
    onSuccess: () => {
      invalidate()
      toast.success('Ajuste aplicado correctamente')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { adjustStock }
}
