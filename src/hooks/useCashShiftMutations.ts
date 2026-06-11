import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { CashShift } from '@/types/database.types'

export function useCashShiftMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const openShift = useMutation({
    mutationFn: async (opening_amount: number): Promise<CashShift> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (!Number.isFinite(opening_amount) || opening_amount < 0) {
        throw new Error('El monto inicial no puede ser negativo')
      }

      // Evitar abrir un segundo turno simultáneo del mismo usuario.
      const { data: existing, error: checkErr } = await supabase
        .from('cash_shifts')
        .select('id')
        .eq('store_id' as never, storeId)
        .eq('opened_by' as never, userId)
        .is('closed_at' as never, null)
        .maybeSingle()

      if (checkErr) throw checkErr
      if (existing) {
        throw new Error('Ya tienes un turno abierto')
      }

      const { data, error } = await supabase
        .from('cash_shifts')
        .insert({
          store_id: storeId,
          opened_by: userId,
          opening_amount,
        } as never)
        .select()
        .single()

      if (error || !data) {
        throw new Error(error?.message ?? 'No se pudo abrir el turno')
      }
      return data as unknown as CashShift
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cash-shifts'] })
      toast.success('Turno abierto')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const closeShift = useMutation({
    mutationFn: async ({
      shift_id,
      closing_amount,
    }: {
      shift_id: string
      closing_amount: number
    }): Promise<CashShift> => {
      const userId = profile?.id
      if (!userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (!Number.isFinite(closing_amount) || closing_amount < 0) {
        throw new Error('El monto contado no puede ser negativo')
      }

      const { data, error } = await supabase
        .from('cash_shifts')
        .update({
          closing_amount,
          closed_at: new Date().toISOString(),
          closed_by: userId,
        } as never)
        .eq('id' as never, shift_id)
        .select()
        .single()

      if (error || !data) {
        throw new Error(error?.message ?? 'No se pudo cerrar el turno')
      }
      return data as unknown as CashShift
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cash-shifts'] })
      // El historial usa su propia key; sin esto no se refresca al cerrar
      // (el match por prefijo de ['cash-shifts'] no la cubre).
      void queryClient.invalidateQueries({ queryKey: ['shift-history'] })
      void queryClient.invalidateQueries({ queryKey: ['shift-closing'] })
      toast.success('Turno cerrado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { openShift, closeShift }
}
