import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { Store, Profile } from '@/types/database.types'
import type { StoreConfig } from '@/types/config.types'
import { migrateLegacyPaymentMethods } from '@/lib/paymentMethods'

export const DEFAULT_CONFIG: StoreConfig = {
  timezone: 'America/Bogota',
  currency: 'COP',
  sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  colors: [
    { name: 'Negro', hex: '#000000' },
    { name: 'Blanco', hex: '#ffffff' },
    { name: 'Gris', hex: '#9ca3af' },
    { name: 'Azul', hex: '#3b82f6' },
    { name: 'Rojo', hex: '#ef4444' },
    { name: 'Verde', hex: '#22c55e' },
    { name: 'Amarillo', hex: '#eab308' },
    { name: 'Naranja', hex: '#f97316' },
    { name: 'Violeta', hex: '#8b5cf6' },
    { name: 'Rosa', hex: '#ec4899' },
    { name: 'Café', hex: '#92400e' },
    { name: 'Beige', hex: '#d4b483' },
  ],
  brands: [],
  return_days_limit: 30,
  adjustment_reasons: ['Ingreso de mercancía', 'Ajuste por conteo', 'Merma', 'Otro'],
  payment_methods: ['cash', 'card', 'transfer', 'addi'],
  payment_qr_url: null,
  label_format: '38x25',
  label_fields: { sku: true, name: true, size_color: true, price: true },
}

export function resolveConfig(raw: Record<string, unknown> | null | undefined): StoreConfig {
  if (!raw) return { ...DEFAULT_CONFIG }
  const r = raw as Partial<StoreConfig> & { nequi_qr_url?: string | null }
  const legacyMethods = Array.isArray(r.payment_methods)
    ? migrateLegacyPaymentMethods(r.payment_methods)
    : DEFAULT_CONFIG.payment_methods
  const legacyQrUrl =
    r.payment_qr_url !== undefined ? r.payment_qr_url : (r.nequi_qr_url ?? null)
  return {
    ...DEFAULT_CONFIG,
    ...r,
    colors: Array.isArray(r.colors) ? r.colors : DEFAULT_CONFIG.colors,
    sizes: Array.isArray(r.sizes) ? r.sizes : DEFAULT_CONFIG.sizes,
    brands: Array.isArray(r.brands) ? r.brands : DEFAULT_CONFIG.brands,
    adjustment_reasons: Array.isArray(r.adjustment_reasons)
      ? r.adjustment_reasons
      : DEFAULT_CONFIG.adjustment_reasons,
    payment_methods: legacyMethods,
    payment_qr_url: legacyQrUrl,
    label_fields: r.label_fields
      ? { ...DEFAULT_CONFIG.label_fields, ...r.label_fields }
      : DEFAULT_CONFIG.label_fields,
  }
}

export function useStoreConfig() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery<Store>({
    queryKey: ['store', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id' as never, storeId)
        .single()
      if (error) throw error
      return data as unknown as Store
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}

export function useStoreUsers() {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''

  return useQuery<Profile[]>({
    queryKey: ['store-users', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id' as never, storeId)
        .order('full_name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Profile[]
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}
