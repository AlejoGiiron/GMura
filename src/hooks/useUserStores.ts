import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import type { UserStore } from '@/types/database.types'

// ── useUserStoreAccess ────────────────────────────────────────────────────────
// store_ids a los que un usuario tiene acceso (tabla user_stores).
// Requiere la política admin SELECT de user_stores (migración 014) para poder
// leer los accesos de OTROS usuarios.

export function useUserStoreAccess(userId: string | null) {
  return useQuery({
    queryKey: ['user-stores', userId],
    queryFn: async (): Promise<string[]> => {
      if (!userId) return []
      const { data, error } = await supabase
        .from('user_stores')
        .select('store_id')
        .eq('user_id' as never, userId)
      if (error) throw error
      return ((data ?? []) as unknown as Pick<UserStore, 'store_id'>[]).map(
        (r) => r.store_id,
      )
    },
    enabled: !!userId,
    staleTime: 60_000,
  })
}

// ── useGrantStoreAccess ───────────────────────────────────────────────────────

export function useGrantStoreAccess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      storeId,
    }: {
      userId: string
      storeId: string
    }) => {
      const { error } = await supabase
        .from('user_stores')
        .insert({ user_id: userId, store_id: storeId } as never)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['user-stores', vars.userId] })
      void queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      toast.success('Acceso concedido')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useRevokeStoreAccess ──────────────────────────────────────────────────────

export function useRevokeStoreAccess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      storeId,
    }: {
      userId: string
      storeId: string
    }) => {
      const { error } = await supabase
        .from('user_stores')
        .delete()
        .eq('user_id' as never, userId)
        .eq('store_id' as never, storeId)
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['user-stores', vars.userId] })
      void queryClient.invalidateQueries({ queryKey: ['my-stores'] })
      toast.success('Acceso retirado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
