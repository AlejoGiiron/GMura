import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'
import type { UserRole } from '@/types/database.types'
import type { StoreConfig } from '@/types/config.types'

interface UpdateStoreInput {
  name: string
  address: string | null
  phone: string | null
}

interface CreateUserInput {
  full_name: string
  email: string
  password: string
  role: UserRole
}

export function useConfigMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = profile?.store_id ?? ''

  function invalidateStore() {
    void queryClient.invalidateQueries({ queryKey: ['store', storeId] })
  }

  function invalidateUsers() {
    void queryClient.invalidateQueries({ queryKey: ['store-users', storeId] })
  }

  const updateStore = useMutation({
    mutationFn: async (data: UpdateStoreInput) => {
      const { error } = await supabase
        .from('stores')
        .update(data as never)
        .eq('id' as never, storeId)
      if (error) throw error
    },
    onSuccess: invalidateStore,
    onError: (err: Error) => toast.error(err.message),
  })

  const updateStoreConfig = useMutation({
    mutationFn: async (config: Partial<StoreConfig>) => {
      const { data, error: fetchErr } = await supabase
        .from('stores')
        .select('config')
        .eq('id' as never, storeId)
        .single()
      if (fetchErr) throw fetchErr
      const current = ((data as unknown) as { config: Record<string, unknown> | null }).config ?? {}
      const merged = { ...current, ...config }
      const { error } = await supabase
        .from('stores')
        .update({ config: merged } as never)
        .eq('id' as never, storeId)
      if (error) throw error
    },
    onSuccess: invalidateStore,
    onError: (err: Error) => toast.error(err.message),
  })

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${storeId}/logo.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('store-logos')
        .upload(path, file, { upsert: true })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from('store-logos').getPublicUrl(path)
      const { error } = await supabase
        .from('stores')
        .update({ logo_url: urlData.publicUrl } as never)
        .eq('id' as never, storeId)
      if (error) throw error
      return urlData.publicUrl
    },
    onSuccess: () => {
      invalidateStore()
      toast.success('Logo actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const uploadNequiQR = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${storeId}/nequi-qr.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('store-assets')
        .upload(path, file, { upsert: true })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from('store-assets').getPublicUrl(path)
      return urlData.publicUrl
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const createUser = useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { ...input, store_id: storeId },
      })
      if (error) throw error
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error)
      }
      return data
    },
    onSuccess: () => {
      invalidateUsers()
      toast.success('Usuario creado correctamente')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateUserRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role } as never)
        .eq('id' as never, id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateUsers()
      toast.success('Rol actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleUserActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active } as never)
        .eq('id' as never, id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateUsers()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    updateStore,
    updateStoreConfig,
    uploadLogo,
    uploadNequiQR,
    createUser,
    updateUserRole,
    toggleUserActive,
  }
}
