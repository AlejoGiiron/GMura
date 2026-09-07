import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useDebounce } from './useDebounce'

/**
 * Búsqueda de variantes de MI tienda para el buscador de la pantalla de armar
 * el envío (handoff §0.2).
 *
 * El número que importa es el DISPONIBLE (`stock_qty − reserved_qty`), no el
 * stock crudo: lo apartado para un separado es intocable y `dispatch_transfer`
 * valida contra el disponible. Si la línea dice 6 y 2 están apartadas, el
 * usuario arma un envío de 5 que falla recién al despachar — con la caja
 * esperando.
 *
 * Por eso las variantes sin disponible se FILTRAN del buscador en vez de
 * mostrarse deshabilitadas: no hay nada que hacer con ellas.
 */

export interface StoreVariantOption {
  variant_id: string
  product_id: string
  product_name: string
  brand: string | null
  description: string | null
  size_type: string | null
  size: string | null
  color: string | null
  unit_price: number
  stock_qty: number
  reserved_qty: number
  /** stock_qty − reserved_qty. Es lo que se muestra y lo que topea el stepper. */
  available: number
}

const SELECT =
  'id, product_id, size, color, price, stock_qty, reserved_qty, sku, barcode, ' +
  'products!inner(name, brand, description, size_type, is_active)'

type Row = {
  id: string
  product_id: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  reserved_qty: number
  sku: string | null
  barcode: string | null
  products: {
    name: string
    brand: string | null
    description: string | null
    size_type: string | null
    is_active: boolean
  } | null
}

function toOption(r: Row): StoreVariantOption {
  return {
    variant_id: r.id,
    product_id: r.product_id,
    product_name: r.products?.name ?? '—',
    brand: r.products?.brand ?? null,
    description: r.products?.description ?? null,
    size_type: r.products?.size_type ?? null,
    size: r.size,
    color: r.color,
    unit_price: Number(r.price),
    stock_qty: r.stock_qty,
    reserved_qty: r.reserved_qty,
    available: Math.max(0, r.stock_qty - r.reserved_qty),
  }
}

export function useStoreVariantSearch(query: string, excludeVariantIds: string[] = []) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const debounced = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['store-variant-search', storeId, debounced],
    queryFn: async (): Promise<StoreVariantOption[]> => {
      const q = debounced
      // Dos consultas, como usePurchaseVariantSearch: PostgREST no permite un
      // OR que cruce la tabla embebida y la propia en un solo filtro.
      // (1) por atributos de la VARIANTE
      const byVariant = supabase
        .from('variants')
        .select(SELECT)
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .eq('products.is_active' as never, true)
        .or(`sku.ilike.%${q}%,barcode.ilike.%${q}%,size.ilike.%${q}%,color.ilike.%${q}%`)
        .limit(30)

      // (2) por atributos del PRODUCTO (nombre, marca, descripción)
      const byProduct = supabase
        .from('variants')
        .select(SELECT)
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .eq('products.is_active' as never, true)
        .or(`name.ilike.%${q}%,brand.ilike.%${q}%,description.ilike.%${q}%`, {
          foreignTable: 'products',
        })
        .limit(30)

      const [a, b] = await Promise.all([byVariant, byProduct])
      if (a.error) throw a.error
      if (b.error) throw b.error

      const seen = new Set<string>()
      const out: StoreVariantOption[] = []
      for (const r of [...((a.data ?? []) as unknown as Row[]), ...((b.data ?? []) as unknown as Row[])]) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        out.push(toOption(r))
      }

      return out
        // Sin disponible no hay nada que trasladar: fuera del buscador.
        .filter((v) => v.available > 0 && !excludeVariantIds.includes(v.variant_id))
        .sort((x, y) => x.product_name.localeCompare(y.product_name, 'es'))
        .slice(0, 25)
    },
    enabled: !!storeId && debounced.length >= 2,
  })
}
