import { useAuth } from './useAuth'
import type { Profile } from '@/types/database.types'

// Tienda ACTIVA del usuario (current_store_id). Es la que el RLS de Supabase
// usa (get_my_store_id() = current_store_id), por lo que TODA lectura/escritura
// debe operar sobre ella, no sobre la tienda base (profile.store_id).
//
// Fallbacks:
//  - current_store_id null (estado raro) → store_id base.
//  - sin perfil → '' (las queries deben deshabilitarse con enabled: !!id).

export function getActiveStoreId(
  profile: Pick<Profile, 'current_store_id' | 'store_id'> | null | undefined,
): string {
  return profile?.current_store_id ?? profile?.store_id ?? ''
}

export function useActiveStoreId(): string {
  const { profile } = useAuth()
  return getActiveStoreId(profile)
}
