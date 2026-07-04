import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { Role } from '@/types/database.types'

const STALE_5_MIN = 5 * 60 * 1_000

/**
 * Lista los roles de la organización del usuario. El RLS `roles_select_org`
 * ya limita a los roles de tu org. Lo usan el alta/edición de usuarios y
 * (luego) la UI de gestión de roles (6C).
 */
export function useRoles() {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  return useQuery({
    queryKey: ['roles', userId],
    queryFn: async (): Promise<Role[]> => {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .order('name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Role[]
    },
    enabled: !!userId,
    staleTime: STALE_5_MIN,
  })
}
