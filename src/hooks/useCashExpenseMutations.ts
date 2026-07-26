import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useCurrentShift } from './useCashShift'
import { fmtCOP } from '@/lib/formatters'
import {
  PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_KEYS,
} from '@/lib/paymentMethods'
import type {
  CashExpense,
  ExpensePaymentMethod,
} from '@/types/database.types'

export interface RegisterExpenseInput {
  amount: number
  reason: string
  notes: string
  // Cómo se pagó el gasto (037). Solo 'cash' se resta del efectivo del cuadre.
  payment_method: ExpensePaymentMethod
}

export function useRegisterExpense() {
  const { profile } = useAuth()
  const { data: shift } = useCurrentShift()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegisterExpenseInput): Promise<CashExpense> => {
      const storeId = getActiveStoreId(profile)
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
      if (
        !(EXPENSE_PAYMENT_METHOD_KEYS as readonly string[]).includes(
          input.payment_method,
        )
      ) {
        throw new Error('Selecciona cómo se pagó el gasto')
      }

      const { data, error } = await supabase
        .from('cash_expenses')
        .insert({
          shift_id: shift.id,
          store_id: storeId,
          amount: input.amount,
          reason,
          // Solo 'cash' baja el efectivo esperado del turno; tarjeta y
          // transferencia quedan en el historial sin tocar el cuadre (037).
          payment_method: input.payment_method,
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
      // El cuadre y el historial cambian con el gasto: si no se invalidan, el
      // "Esperado" del turno abierto sigue mostrando el valor anterior.
      void queryClient.invalidateQueries({ queryKey: ['shift-closing'] })
      void queryClient.invalidateQueries({ queryKey: ['expense-history'] })
      const method = PAYMENT_METHODS[expense.payment_method].label
      toast.success(
        `Gasto registrado: ${fmtCOP(Number(expense.amount))} por ${expense.reason} (${method})`,
      )
    },

    onError: (err: Error) => toast.error(err.message),
  })
}
