import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

// Ajuste manual de stock: UNA llamada a la RPC adjust_variant_stock (045).
//
// Antes eran tres llamadas sueltas (leer stock → escribir stock → insertar
// movimiento): se pisaban con ventas simultáneas y, con permisos desalineados,
// podían dejar el movimiento sin el cambio de stock o al revés. La RPC lockea
// la variante, aplica el delta y registra el movimiento en la misma
// transacción. Desde la 045 el stock ya NO se puede escribir directo.

export type AdjustStockInput = {
  variantId: string
  /** Cantidad a sumar (positiva) o restar (negativa). Nunca un absoluto. */
  delta: number
  /** Motivo que queda en el movimiento (obligatorio). */
  reason: string
  /** Solo en conteo físico: el stock que se mostró al calcular el delta. */
  expectedQty?: number | null
}

export type AdjustStockResult = {
  stock_qty: number
  reserved_qty: number
  movement_id: string
}

export function useAdjustStock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ variantId, delta, reason, expectedQty }: AdjustStockInput) => {
      const { data, error } = await supabase.rpc('adjust_variant_stock' as never, {
        p_variant_id: variantId,
        p_delta: delta,
        p_reason: reason,
        p_expected_qty: expectedQty ?? null,
      } as never)
      if (error) throw error
      const row = (data as unknown as AdjustStockResult[] | null)?.[0]
      if (!row) throw new Error('El ajuste no devolvió resultado')
      return row
    },
    onSuccess: () => {
      // Todo lo que muestra stock: inventario, panel de variantes, matriz de
      // productos, POS y el historial de movimientos.
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      toast.success('Ajuste registrado')
    },
    // Los RAISE de la RPC llegan en español ("No se puede dejar menos de lo
    // apartado…", "El stock cambió mientras ajustabas…").
    onError: (err: Error) => toast.error(err.message),
  })
}
