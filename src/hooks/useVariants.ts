import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Variant } from '@/types/database.types'

export function useVariants(productId: string) {
  return useQuery({
    queryKey: ['variants', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('variants')
        .select('*')
        .eq('product_id' as never, productId)
        .order('size' as never)
        .order('color' as never)
      if (error) throw error
      return (data ?? []) as Variant[]
    },
    enabled: !!productId,
    staleTime: 30_000,
  })
}
