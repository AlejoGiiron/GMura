import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'
import type { Category } from '@/types/database.types'

type CreateCategoryInput = {
  name: string
  color: string | null
  sort_order: number
}

type UpdateCategoryInput = {
  id: string
  name?: string
  color?: string | null
}

export function useCategoryMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = profile?.store_id ?? ''

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['categories', storeId] })
    void queryClient.invalidateQueries({ queryKey: ['categories-all', storeId] })
  }

  const create = useMutation({
    mutationFn: async (input: CreateCategoryInput) => {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          name: input.name,
          color: input.color,
          sort_order: input.sort_order,
          store_id: storeId,
          is_active: true,
        } as never)
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: () => {
      invalidate()
      toast.success('Categoría creada')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, ...changes }: UpdateCategoryInput) => {
      const { data, error } = await supabase
        .from('categories')
        .update(changes as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: () => {
      invalidate()
      toast.success('Categoría actualizada')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data, error } = await supabase
        .from('categories')
        .update({ is_active: !isActive } as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: (_data, variables) => {
      invalidate()
      toast.success(variables.isActive ? 'Categoría desactivada' : 'Categoría activada')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function reorder(orderedIds: string[]) {
    try {
      await Promise.all(
        orderedIds.map((id, idx) =>
          supabase
            .from('categories')
            .update({ sort_order: (idx + 1) * 10 } as never)
            .eq('id' as never, id)
            .then(({ error }) => {
              if (error) throw error
            })
        )
      )
      invalidate()
    } catch {
      toast.error('Error reordenando categorías')
      invalidate()
    }
  }

  return { create, update, toggleActive, reorder }
}
