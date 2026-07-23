import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { StoreConfig } from '@/types/config.types'
import { deriveLegacyRole } from '@/lib/permissions'

interface UpdateStoreInput {
  name: string
  address: string | null
  phone: string | null
}

interface CreateUserInput {
  full_name: string
  email: string
  password: string
  // Rol RBAC elegido. La Edge Function deriva organization_id (de la tienda
  // base), el enum legacy (de los permisos del rol) y valida la coherencia.
  role_id: string
  // Multi-tienda: la primera es la base (store_id) y la activa inicial.
  // Para roles no-gestores la Edge Function ignora todas menos la primera.
  store_ids: string[]
}

export function useConfigMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

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
      // Limpia la clave legacy nequi_qr_url cuando se actualiza payment_qr_url
      // para evitar dejarla obsoleta en jsonb.
      if ('payment_qr_url' in config && 'nequi_qr_url' in merged) {
        delete (merged as Record<string, unknown>).nequi_qr_url
      }
      // Limpia la clave legacy label_format cuando se actualizan los tamaños
      // de etiqueta (reemplazada por label_sizes + label_default_size_id).
      if ('label_sizes' in config && 'label_format' in merged) {
        delete (merged as Record<string, unknown>).label_format
      }
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

  const uploadPaymentQR = useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${storeId}/payment-qr.${ext}`
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
        body: input,
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

  const resetUserPassword = useMutation({
    mutationFn: async (input: {
      user_id: string
      new_password: string
      reactivate?: boolean
    }) => {
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: input,
      })
      if (error) {
        // La Edge Function devuelve { error } con 4xx; supabase-js entrega un
        // FunctionsHttpError genérico y el cuerpo en error.context. Lo leemos
        // para mostrar el mensaje real (cross-org, Dueño, etc.).
        let msg = error.message
        try {
          const ctx = (error as { context?: Response }).context
          if (ctx) {
            const parsed = (await ctx.json()) as { error?: string }
            if (parsed?.error) msg = parsed.error
          }
        } catch {
          // sin cuerpo legible → usar error.message
        }
        throw new Error(msg)
      }
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error)
      }
      return data as { success: boolean; reactivated?: boolean; warning?: string }
    },
    onSuccess: (data) => {
      invalidateUsers()
      if (data?.warning) toast.error(data.warning)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateUserRole = useMutation({
    mutationFn: async ({ id, roleId }: { id: string; roleId: string }) => {
      // Deriva el enum legacy de los permisos del rol para no dejarlo stale.
      const { data: role, error: roleErr } = await supabase
        .from('roles')
        .select('permissions')
        .eq('id' as never, roleId)
        .single()
      if (roleErr) throw roleErr
      const legacy = deriveLegacyRole((role as { permissions: string[] }).permissions)
      const { error } = await supabase
        .from('profiles')
        .update({ role_id: roleId, role: legacy } as never)
        .eq('id' as never, id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateUsers()
      toast.success('Rol actualizado. El usuario debe volver a entrar para que aplique.')
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
    uploadPaymentQR,
    createUser,
    resetUserPassword,
    updateUserRole,
    toggleUserActive,
  }
}
