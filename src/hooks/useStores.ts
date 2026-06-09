import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { MyStore, Store } from '@/types/database.types'

const STALE_5_MIN = 5 * 60 * 1_000

// ── useMyStores ───────────────────────────────────────────────────────────────
// Tiendas a las que el usuario tiene acceso (RPC get_my_stores).
// Para vendedores devuelve una sola; para admins multi-tienda, varias.

export function useMyStores() {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  return useQuery({
    queryKey: ['my-stores', userId],
    queryFn: async (): Promise<MyStore[]> => {
      const { data, error } = await supabase.rpc('get_my_stores' as never)
      if (error) throw error
      return (data ?? []) as unknown as MyStore[]
    },
    enabled: !!userId,
    staleTime: STALE_5_MIN,
  })
}

// ── useSwitchStore ────────────────────────────────────────────────────────────
// Cambia la tienda activa (RPC switch_active_store). Al cambiar, TODA la data
// de la app cambia, así que se invalida todo el caché y se recarga el perfil.

export function useSwitchStore() {
  const queryClient = useQueryClient()
  const { refreshProfile } = useAuth()

  return useMutation({
    mutationFn: async (target: { store_id: string; store_name: string }) => {
      const { error } = await supabase.rpc(
        'switch_active_store' as never,
        { target_store_id: target.store_id } as never,
      )
      if (error) throw error
      return target
    },
    onSuccess: async (target) => {
      // El perfil debe reflejar el nuevo current_store_id antes de refetchear.
      await refreshProfile()
      // Toda la data está scoping por store_id vía RLS → recargar todo.
      await queryClient.invalidateQueries()
      toast.success(`Cambiado a ${target.store_name}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useAllMyStoresDetailed ────────────────────────────────────────────────────
// Tiendas accesibles del admin con sus datos completos (no solo id/name como
// get_my_stores). El RLS (políticas de la migración 015) limita a las tiendas
// a las que el usuario tiene acceso.

export function useAllMyStoresDetailed() {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  return useQuery({
    queryKey: ['stores-detailed', userId],
    queryFn: async (): Promise<Store[]> => {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .order('name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Store[]
    },
    enabled: !!userId,
    staleTime: STALE_5_MIN,
  })
}

// ── useCreateStore ────────────────────────────────────────────────────────────
// Crea una sucursal y da acceso automático al admin creador (RPC atómica).

export interface CreateStoreInput {
  name: string
  address: string | null
  phone: string | null
}

export function useCreateStore() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateStoreInput): Promise<string> => {
      const { data, error } = await supabase.rpc(
        'create_store_with_access' as never,
        {
          p_name: input.name,
          p_address: input.address,
          p_phone: input.phone,
        } as never,
      )
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: () => {
      // El switcher (my-stores) y la lista detallada deben reflejar la nueva.
      void queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      void queryClient.invalidateQueries({ queryKey: ['stores-detailed'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useUpdateStore ────────────────────────────────────────────────────────────

export interface UpdateStoreInput {
  id: string
  name: string
  address: string | null
  phone: string | null
}

export function useUpdateStore() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateStoreInput) => {
      const { error } = await supabase
        .from('stores')
        .update({
          name: input.name,
          address: input.address,
          phone: input.phone,
        } as never)
        .eq('id' as never, input.id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      void queryClient.invalidateQueries({ queryKey: ['stores-detailed'] })
      // useStoreConfig lee la tienda base; refrescar por si se editó.
      void queryClient.invalidateQueries({ queryKey: ['store'] })
      toast.success('Sucursal actualizada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useToggleStoreActive ──────────────────────────────────────────────────────

export function useToggleStoreActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('stores')
        .update({ is_active: input.is_active } as never)
        .eq('id' as never, input.id)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['stores-detailed'] })
      void queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      toast.success(vars.is_active ? 'Sucursal activada' : 'Sucursal desactivada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
