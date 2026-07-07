import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

/** Traduce errores de Postgres a mensajes amables. */
function friendlyRoleError(err: unknown): Error {
  const e = err as { code?: string; message?: string }
  if (e?.code === '23505') {
    return new Error('Ya existe un rol con ese nombre en tu organización.')
  }
  // El trigger de inmutabilidad del Dueño ya lanza un mensaje legible.
  return new Error(e?.message ?? 'No se pudo completar la operación.')
}

export function useRoleMutations() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['roles'] })
  }

  const createRole = useMutation({
    mutationFn: async ({ name, permissions }: { name: string; permissions: string[] }) => {
      const organization_id = profile?.organization_id
      if (!organization_id) throw new Error('No se pudo determinar la organización.')
      const { error } = await supabase
        .from('roles')
        .insert({ name, permissions, organization_id } as never)
      if (error) throw friendlyRoleError(error)
    },
    onSuccess: () => {
      invalidate()
      toast.success('Rol creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateRole = useMutation({
    mutationFn: async ({
      id,
      name,
      permissions,
    }: {
      id: string
      name: string
      permissions: string[]
    }) => {
      const { error } = await supabase
        .from('roles')
        .update({ name, permissions } as never)
        .eq('id' as never, id)
      if (error) throw friendlyRoleError(error)
    },
    onSuccess: () => {
      invalidate()
      toast.success(
        'Rol actualizado. Los cambios aplican cuando cada usuario vuelve a entrar.',
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('roles').delete().eq('id' as never, id)
      if (error) throw friendlyRoleError(error)
    },
    onSuccess: () => {
      invalidate()
      toast.success('Rol eliminado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { createRole, updateRole, deleteRole }
}
