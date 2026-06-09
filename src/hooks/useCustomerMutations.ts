import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { Customer } from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerFormData = {
  full_name: string
  phone: string
  email: string
  document_id: string
  notes: string
}

// ── useCreateCustomer ─────────────────────────────────────────────────────────

export function useCreateCustomer() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CustomerFormData): Promise<Customer> => {
      const storeId = getActiveStoreId(profile)
      const { data: row, error } = await supabase
        .from('customers')
        .insert({
          store_id: storeId,
          full_name: data.full_name,
          phone: data.phone || null,
          email: data.email || null,
          document_id: data.document_id || null,
          notes: data.notes || null,
        } as never)
        .select()
        .single()
      if (error) throw error
      return row as unknown as Customer
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Cliente creado exitosamente')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useUpdateCustomer ─────────────────────────────────────────────────────────

export function useUpdateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: Partial<CustomerFormData>
    }): Promise<Customer> => {
      const { data: row, error } = await supabase
        .from('customers')
        .update({
          ...(data.full_name !== undefined && { full_name: data.full_name }),
          ...(data.phone !== undefined && { phone: data.phone || null }),
          ...(data.email !== undefined && { email: data.email || null }),
          ...(data.document_id !== undefined && { document_id: data.document_id || null }),
          ...(data.notes !== undefined && { notes: data.notes || null }),
        } as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return row as unknown as Customer
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['customers', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['customers', 'profile', vars.id] })
      toast.success('Cliente actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
