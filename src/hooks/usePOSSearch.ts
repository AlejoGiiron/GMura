import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useDebounce } from './useDebounce'
import type { Category } from '@/types/database.types'

export interface POSVariant {
  id: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  barcode: string | null
  sku: string | null
  is_active: boolean
}

export interface POSProduct {
  id: string
  name: string
  brand: string | null
  image_url: string | null
  category: Pick<Category, 'id' | 'name' | 'color'> | null
  variants: POSVariant[]
}

interface RawProduct {
  id: string
  name: string
  brand: string | null
  image_url: string | null
  categories: { id: string; name: string; color: string | null } | null
  variants: POSVariant[]
}

function usePOSProducts() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery({
    queryKey: ['pos-products', storeId],
    queryFn: async (): Promise<POSProduct[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, brand, image_url, categories(id, name, color), variants(id, size, color, price, stock_qty, barcode, sku, is_active)',
        )
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .order('name' as never)
      if (error) throw error
      return (data ?? []).map((row) => {
        const r = row as unknown as RawProduct
        return {
          id: r.id,
          name: r.name,
          brand: r.brand,
          image_url: r.image_url,
          category: r.categories,
          variants: (r.variants ?? []).filter((v) => v.is_active),
        }
      })
    },
    enabled: !!storeId,
    staleTime: 60_000,
  })
}

export function usePOSSearch(query: string) {
  const dq = useDebounce(query.trim(), 300)
  const { data: all = [], isLoading } = usePOSProducts()

  const data = useMemo(() => {
    if (!dq) return all
    const lower = dq.toLowerCase()
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        (p.brand ?? '').toLowerCase().includes(lower) ||
        p.variants.some(
          (v) => v.barcode === dq || (v.sku ?? '').toLowerCase().includes(lower),
        ),
    )
  }, [all, dq])

  return { data, isLoading }
}

/** Returns the single variant that matches an exact barcode scan, or null. */
export function findVariantByBarcode(
  products: POSProduct[],
  barcode: string,
): { product: POSProduct; variant: POSVariant } | null {
  for (const p of products) {
    const v = p.variants.find((v) => v.barcode === barcode)
    if (v) return { product: p, variant: v }
  }
  return null
}
