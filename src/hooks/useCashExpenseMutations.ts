import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { useAuth } from './useAuth'
import { useCurrentShift } from './useCashShift'
import { fmtCOP } from '@/lib/formatters'
import type { CashExpense } from '@/types/database.types'

export interface RegisterExpenseInput {
  amount: number
  reason: string
  notes: string
}

export function useRegisterExpense() {
  const { profile } = useAuth()
  const { data: shift } = useCurrentShift()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegisterExpenseInput): Promise<CashExpense> => {
      const storeId = profile?.store_id
      const userId = profile?.id

      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (!shift) {
        throw new Error('Debes abrir un turno antes de registrar gastos.')
      }
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('El monto debe ser mayor a 0')
      }
      const reason = input.reason.trim()
      if (!reason) {
        throw new Error('Selecciona un motivo')
      }

      const { data, error } = await supabase
        .from('cash_expenses')
        .insert({
          shift_id: shift.id,
          store_id: storeId,
          amount: input.amount,
          reason,
          notes: input.notes.trim() || null,
          created_by: userId,
        } as never)
        .select()
        .single()

      if (error || !data) {
        throw new Error(error?.message ?? 'No se pudo registrar el gasto')
      }
      return data as unknown as CashExpense
    },

    onSuccess: (expense) => {
      void queryClient.invalidateQueries({
        queryKey: ['shift-expenses', expense.shift_id],
      })
      void queryClient.invalidateQueries({ queryKey: ['shift-expenses'] })
      toast.success(
        `Gasto registrado: ${fmtCOP(Number(expense.amount))} por ${expense.reason}`,
      )
    },

    onError: (err: Error) => toast.error(err.message),
  })
}
