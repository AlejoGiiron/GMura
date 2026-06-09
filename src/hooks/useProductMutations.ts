import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { Product } from '@/types/database.types'

type CreateProductInput = {
  name: string
  description: string | null
  brand: string | null
  category_id: string | null
  image_url: string | null
  size_type: string
}

type UpdateProductInput = Partial<CreateProductInput> & { id: string }

export function useProductMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['products', storeId] })
  }

  const create = useMutation({
    mutationFn: async (input: CreateProductInput) => {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...input, store_id: storeId, is_active: true } as never)
        .select()
        .single()
      if (error) throw error
      return data as Product
    },
    onSuccess: () => {
      invalidate()
      toast.success('Producto creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, ...changes }: UpdateProductInput) => {
      const { data, error } = await supabase
        .from('products')
        .update(changes as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Product
    },
    onSuccess: () => {
      invalidate()
      toast.success('Producto actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function uploadImage(file: File, fileId: string): Promise<string | null> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${storeId}/${fileId}.${ext}`
    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, file, { upsert: true })
    if (error) {
      toast.error('Error subiendo imagen: ' + error.message)
      return null
    }
    return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
  }

  return { create, update, uploadImage }
}
