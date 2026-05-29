import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { MyStore } from '@/types/database.types'

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
