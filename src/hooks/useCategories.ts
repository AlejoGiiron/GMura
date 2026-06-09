import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { Category } from '@/types/database.types'

/** Fetches ALL categories (active + inactive) — for admin management. */
export function useAllCategories() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['categories-all', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id' as never, storeId)
        .order('sort_order' as never)
      if (error) throw error
      return (data ?? []) as Category[]
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}
