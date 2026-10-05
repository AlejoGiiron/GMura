import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import type { SalesByCategoryRow } from '@/lib/categoryReport'

const STALE_5_MIN = 5 * 60 * 1_000

// ── useSalesByCategory ────────────────────────────────────────────────────────
// Ventas por categoría × talla (RPC report_sales_by_category, migración 044).
// storeIds con UNA tienda = informe de esa tienda; con varias = consolidado.
// La RPC valida que cada tienda sea del usuario y de su organización: no hay
// que filtrar acá, y no depende de la tienda activa (el RLS no aplica).

export interface SalesByCategoryParams {
  storeIds: string[]
  /** YYYY-MM-DD civil de Bogotá, incluido. */
  dateFrom: string
  /** YYYY-MM-DD civil de Bogotá, incluido. */
  dateTo: string
}

export function useSalesByCategory({ storeIds, dateFrom, dateTo }: SalesByCategoryParams) {
  // Orden estable: la misma selección en otro orden no debe re-consultar.
  const ids = [...storeIds].sort()

  return useQuery({
    queryKey: ['planning-reports', 'sales-by-category', ids, dateFrom, dateTo],
    queryFn: async (): Promise<SalesByCategoryRow[]> => {
      const { data, error } = await supabase.rpc('report_sales_by_category' as never, {
        p_store_ids: ids,
        p_from: dateFrom,
        p_to: dateTo,
      } as never)
      if (error) {
        // Los RAISE de la RPC vienen en español ("No tenés acceso…").
        toast.error(error.message || 'Error cargando ventas por categoría')
        throw error
      }
      return (data ?? []) as unknown as SalesByCategoryRow[]
    },
    enabled: ids.length > 0 && !!dateFrom && !!dateTo && dateFrom <= dateTo,
    staleTime: STALE_5_MIN,
  })
}
