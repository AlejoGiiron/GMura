import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { Category, Product, Variant } from '@/types/database.types'

export type ProductWithDetails = Product & {
  categories: Pick<Category, 'id' | 'name' | 'color'> | null
  variants: Pick<Variant, 'id' | 'stock_qty' | 'is_active'>[]
}

export function useProducts() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['products', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(id, name, color), variants(id, stock_qty, is_active)')
        .eq('store_id' as never, storeId)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as ProductWithDetails[]
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

export function useCategories() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['categories', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .order('sort_order' as never)
      if (error) throw error
      return (data ?? []) as Category[]
    },
    enabled: !!storeId,
    staleTime: 60_000,
  })
}
