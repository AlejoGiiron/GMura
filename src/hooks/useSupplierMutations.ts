import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import toast from 'react-hot-toast'
import type { Supplier } from '@/types/database.types'

export interface SupplierFormData {
  name: string
  nit: string
  contact_name: string
  phone: string
  email: string
  address: string
  payment_terms_days: number
  notes: string
}

function invalidateSuppliers(
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  void queryClient.invalidateQueries({ queryKey: ['suppliers'] })
  if (id) {
    void queryClient.invalidateQueries({ queryKey: ['suppliers', 'detail', id] })
  }
}

// ── useCreateSupplier ─────────────────────────────────────────────────────────

export function useCreateSupplier() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: SupplierFormData): Promise<Supplier> => {
      const storeId = profile?.store_id
      if (!storeId) throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      if (!data.name.trim()) throw new Error('El nombre del proveedor es obligatorio')

      const { data: row, error } = await supabase
        .from('suppliers')
        .insert({
          store_id: storeId,
          name: data.name.trim(),
          nit: data.nit.trim() || null,
          contact_name: data.contact_name.trim() || null,
          phone: data.phone.trim() || null,
          email: data.email.trim() || null,
          address: data.address.trim() || null,
          payment_terms_days: Math.max(0, Math.round(data.payment_terms_days || 0)),
          notes: data.notes.trim() || null,
        } as never)
        .select()
        .single()
      if (error) throw error
      return row as unknown as Supplier
    },
    onSuccess: () => {
      invalidateSuppliers(queryClient)
      toast.success('Proveedor creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useUpdateSupplier ─────────────────────────────────────────────────────────

export function useUpdateSupplier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: SupplierFormData
    }): Promise<Supplier> => {
      if (!data.name.trim()) throw new Error('El nombre del proveedor es obligatorio')
      const { data: row, error } = await supabase
        .from('suppliers')
        .update({
          name: data.name.trim(),
          nit: data.nit.trim() || null,
          contact_name: data.contact_name.trim() || null,
          phone: data.phone.trim() || null,
          email: data.email.trim() || null,
          address: data.address.trim() || null,
          payment_terms_days: Math.max(0, Math.round(data.payment_terms_days || 0)),
          notes: data.notes.trim() || null,
        } as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return row as unknown as Supplier
    },
    onSuccess: (_data, vars) => {
      invalidateSuppliers(queryClient, vars.id)
      toast.success('Proveedor actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useToggleSupplierActive ───────────────────────────────────────────────────

export function useToggleSupplierActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      isActive,
    }: {
      id: string
      isActive: boolean
    }): Promise<Supplier> => {
      const { data: row, error } = await supabase
        .from('suppliers')
        .update({ is_active: !isActive } as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return row as unknown as Supplier
    },
    onSuccess: (_data, vars) => {
      invalidateSuppliers(queryClient, vars.id)
      toast.success(vars.isActive ? 'Proveedor desactivado' : 'Proveedor activado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
