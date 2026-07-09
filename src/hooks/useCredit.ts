import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { creditBalance } from '@/lib/creditCalc'
import type { CreditBalance } from '@/types/database.types'

const STALE_30_S = 30_000

// ── useCreditBalances ─────────────────────────────────────────────────────────
// Cartera de fiados: clientes con saldo pendiente (cuentas por cobrar), desde la
// vista credit_balance (029). Calco de useSupplierBalances.

export interface CreditBalanceRow extends CreditBalance {
  pending_amount: number
  total_credit_sales: number
  open_credits: number
}

export interface CreditBalancesData {
  balances: CreditBalanceRow[]
  totalPending: number
  customersWithDebt: number
  openCredits: number
}

export function useCreditBalances() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CreditBalancesData>({
    queryKey: ['credit-balance', 'list', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_balance' as never)
        .select('*')
        .order('pending_amount' as never, { ascending: false })
      if (error) throw error

      const balances = ((data ?? []) as unknown as CreditBalance[])
        .map((r) => ({
          ...r,
          pending_amount: Number(r.pending_amount) || 0,
          total_credit_sales: Number(r.total_credit_sales) || 0,
          open_credits: Number(r.open_credits) || 0,
        }))
        // La vista incluye a TODOS los clientes (LEFT JOIN); la cartera solo
        // muestra a los que deben.
        .filter((r) => r.pending_amount > 0)

      return {
        balances,
        totalPending: balances.reduce((s, r) => s + r.pending_amount, 0),
        customersWithDebt: balances.length,
        openCredits: balances.reduce((s, r) => s + r.open_credits, 0),
      }
    },
    enabled: !!storeId,
    staleTime: STALE_30_S,
  })
}

// ── useCustomerCredits ────────────────────────────────────────────────────────
// Fiados ABIERTOS (con saldo) de un cliente, del más viejo al más nuevo, para el
// detalle de cartera y el registro de abonos.

export interface CustomerCreditRow {
  id: string
  order_number: number
  total: number
  paid_amount: number
  balance: number
  created_at: string
}

type RawCreditOrder = {
  id: string
  order_number: number
  total: number | string
  paid_amount: number | string
  created_at: string
}

export function useCustomerCredits(customerId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CustomerCreditRow[]>({
    queryKey: ['credit', 'detail', customerId, storeId],
    queryFn: async () => {
      if (!customerId) return []
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, total, paid_amount, created_at')
        .eq('store_id' as never, storeId)
        .eq('customer_id' as never, customerId)
        .eq('is_credit' as never, true)
        .eq('status' as never, 'completed')
        .order('created_at' as never, { ascending: true })
      if (error) throw error

      return ((data ?? []) as unknown as RawCreditOrder[])
        .map((o) => {
          const total = Number(o.total) || 0
          const paid = Number(o.paid_amount) || 0
          return {
            id: o.id,
            order_number: o.order_number,
            total,
            paid_amount: paid,
            balance: creditBalance(total, paid),
            created_at: o.created_at,
          }
        })
        // Solo los que aún deben (saldo > 0).
        .filter((o) => o.balance > 0)
    },
    enabled: !!storeId && !!customerId,
    staleTime: STALE_30_S,
  })
}
